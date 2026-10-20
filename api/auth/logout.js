import { clearSessionCookie, cookie, exactOrigin, hash } from '../../lib/auth.js';
import { withKittyDatabase } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!exactOrigin(req)) return res.status(403).json({ error: 'origin_denied' });
  const token = cookie(req, '__Host-kitty-session');
  try {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await withKittyDatabase(client => client.query('update kitty_private.sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [hash(token)]));
    }
    res.setHeader('Set-Cookie', clearSessionCookie);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ error: 'logout_unavailable' });
  }
}
