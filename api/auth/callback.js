import { callback, clientId, clearFlowCookie, cookie, equal, hash, issuer, randomToken, sessionCookie, validAuthorizationTokens, validateIdentityToken } from '../../lib/auth.js';
import { withKittyDatabase } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Set-Cookie', clearFlowCookie);
  if (!clientId()) return res.status(503).json({ error: 'identity_unconfigured' });
  const state = req.query?.state;
  const code = req.query?.code;
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !equal(state, cookie(req, '__Host-kitty-oidc')) || typeof code !== 'string' || code.length > 4096 || !code) {
    return res.status(400).json({ error: 'identity_flow_invalid' });
  }
  try {
    const flow = await withKittyDatabase(async client => {
      const { rows } = await client.query(`
        delete from kitty_private.auth_flows
        where state_hash = $1 and expires_at > now() and consumed_at is null
        returning pkce_verifier, nonce
      `, [hash(state)]);
      return rows[0];
    });
    if (!flow) return res.status(400).json({ error: 'identity_flow_expired' });
    const tokenResponse = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId(), redirect_uri: callback, code_verifier: flow.pkce_verifier }),
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
    });
    if (!tokenResponse.ok) throw new Error('token_exchange_failed');
    const tokens = await tokenResponse.json();
    if (!validAuthorizationTokens(tokens)) throw new Error('token_response_invalid');
    const identity = await validateIdentityToken(tokens.id_token, flow.nonce);
    const session = randomToken();
    await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const member = await client.query(`
          insert into kitty_private.members(grasany_subject, display_name)
          values($1, $2)
          on conflict (grasany_subject) do update set display_name = excluded.display_name
          returning id
        `, [identity.subject, identity.name]);
        await client.query(`
          insert into kitty_private.sessions(token_hash, member_id, expires_at)
          values($1, $2, now() + interval '12 hours')
        `, [hash(session), member.rows[0].id]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
    res.setHeader('Set-Cookie', [clearFlowCookie, sessionCookie(session)]);
    res.setHeader('Location', '/');
    return res.status(302).end();
  } catch {
    return res.status(503).json({ error: 'identity_unavailable' });
  }
}
