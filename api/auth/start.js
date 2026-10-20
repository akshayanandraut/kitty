import { issuer, callback, clientId, randomToken, hash, flowCookie } from '../../lib/auth.js';
import { withKittyDatabase } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const id = clientId();
  if (!id) return res.status(503).json({ error: 'identity_unconfigured' });
  const state = randomToken(), nonce = randomToken(), verifier = randomToken();
  try {
    await withKittyDatabase(async client => {
      await client.query("delete from kitty_private.auth_flows where expires_at < now() - interval '1 hour'");
      await client.query(`
        insert into kitty_private.auth_flows(state_hash, pkce_verifier, nonce, expires_at)
        values($1, $2, $3, now() + interval '10 minutes')
      `, [hash(state), verifier, nonce]);
    });
    const target = new URL(`${issuer}/oauth/authorize`);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('client_id', id);
    target.searchParams.set('redirect_uri', callback);
    target.searchParams.set('scope', 'openid email profile');
    target.searchParams.set('state', state);
    target.searchParams.set('nonce', nonce);
    target.searchParams.set('code_challenge', Buffer.from(hash(verifier), 'hex').toString('base64url'));
    target.searchParams.set('code_challenge_method', 'S256');
    res.setHeader('Set-Cookie', flowCookie(state));
    res.setHeader('Location', target.toString());
    return res.status(302).end();
  } catch {
    return res.status(503).json({ error: 'identity_unavailable' });
  }
}
