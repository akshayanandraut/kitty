import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { withKittyDatabase } from './db.js';

export const origin = 'https://kitty.grasany.com';
export const issuer = 'https://grtjbgksspckvtrvwwbm.supabase.co/auth/v1';
export const callback = `${origin}/auth/callback`;
export const authorizationScope = 'openid email profile';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5000 });

export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const clientId = () => process.env.KITTY_OIDC_CLIENT_ID || null;
export function currentKyc(member, now = new Date()) {
  const checked = member.identity_checked_at && new Date(member.identity_checked_at);
  const expires = member.identity_expires_at && new Date(member.identity_expires_at);
  return member.identity_status === 'verified' &&
    checked instanceof Date && Number.isFinite(checked.getTime()) && checked <= now &&
    expires instanceof Date && Number.isFinite(expires.getTime()) && expires > now &&
    typeof member.identity_version === 'string' && Boolean(member.identity_version.trim()) &&
    typeof member.identity_consent_version === 'string' && Boolean(member.identity_consent_version.trim());
}
export function validAuthorizationTokens(tokens) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return false;
  for (const key of ['access_token', 'id_token', 'refresh_token']) {
    if (typeof tokens[key] !== 'string' || !tokens[key].trim()) return false;
  }
  if (typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') return false;
  if (!Number.isSafeInteger(tokens.expires_in) || tokens.expires_in <= 0) return false;
  // RFC 6749 permits scope to be omitted when it matches the authorization request.
  if (!Object.hasOwn(tokens, 'scope')) return true;
  if (typeof tokens.scope !== 'string') return false;
  const actual = tokens.scope.split(' ');
  const expected = authorizationScope.split(' ');
  return actual.length === expected.length && new Set(actual).size === expected.length && expected.every(scope => actual.includes(scope));
}
export const sessionCookie = token => `__Host-kitty-session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`;
export const clearSessionCookie = '__Host-kitty-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
export const flowCookie = state => `__Host-kitty-oidc=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`;
export const clearFlowCookie = '__Host-kitty-oidc=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';

export function cookie(req, name) {
  const values = String(req.headers.cookie || '').split(';');
  const item = values.find(x => x.trimStart().startsWith(`${name}=`));
  return item ? item.trim().slice(name.length + 1) : null;
}

export function exactOrigin(req) {
  return req.headers.origin === origin;
}

export async function validateIdentityToken(token, expectedNonce) {
  const id = clientId();
  if (!id) throw new Error('identity_unconfigured');
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: id,
    algorithms: ['ES256', 'RS256'],
    clockTolerance: 10,
    maxTokenAge: '10m',
  });
  if (!equal(payload.nonce, expectedNonce) || !payload.sub || payload.email_verified !== true || (payload.azp && payload.azp !== id)) throw new Error('identity_invalid');
  return {
    subject: `${issuer}|${payload.sub}`,
    name: String(payload.name || payload.preferred_username || 'Kitty member').trim().slice(0, 80) || 'Kitty member',
  };
}

export async function getSession(req) {
  const token = cookie(req, '__Host-kitty-session');
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return withKittyDatabase(async client => {
    const { rows } = await client.query(`
      select m.id, m.display_name, m.adult_attested_at, m.women_only_attested_at,
             m.identity_status, m.identity_checked_at, m.identity_expires_at,
             m.identity_version, m.identity_consent_version, m.access_status
      from kitty_private.sessions s
      join kitty_private.members m on m.id = s.member_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and m.deleted_at is null
    `, [hash(token)]);
    if (!rows[0]) return null;
    const m = rows[0];
    return { id: m.id, name: m.display_name, adultAttested: Boolean(m.adult_attested_at), womenOnlyAttested: Boolean(m.women_only_attested_at), identityStatus: currentKyc(m) ? 'verified' : m.identity_status === 'verified' ? 'expired' : m.identity_status, accessStatus: m.access_status };
  });
}
