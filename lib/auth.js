import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { withKittyDatabase } from './db.js';

export const origin = 'https://kitty.grasany.com';
export const issuer = 'https://grtjbgksspckvtrvwwbm.supabase.co/auth/v1';
export const callback = `${origin}/auth/callback`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5000 });

export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const clientId = () => process.env.KITTY_OIDC_CLIENT_ID || null;
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
             m.identity_status, m.access_status
      from kitty_private.sessions s
      join kitty_private.members m on m.id = s.member_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and m.deleted_at is null
    `, [hash(token)]);
    if (!rows[0]) return null;
    const m = rows[0];
    return { id: m.id, name: m.display_name, adultAttested: Boolean(m.adult_attested_at), womenOnlyAttested: Boolean(m.women_only_attested_at), identityStatus: m.identity_status, accessStatus: m.access_status };
  });
}
