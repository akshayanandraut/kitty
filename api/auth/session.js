import { getSession } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const member = await getSession(req);
    return res.status(200).json({ member });
  } catch {
    return res.status(503).json({ error: 'session_unavailable' });
  }
}
