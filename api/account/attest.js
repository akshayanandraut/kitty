import { exactOrigin, getSession } from '../../lib/auth.js';
import { withKittyDatabase } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!exactOrigin(req)) return res.status(403).json({ error: 'origin_denied' });
  if (Number(req.headers['content-length'] || 0) > 512) return res.status(413).json({ error: 'body_too_large' });
  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 512 || Object.keys(input).sort().join(',') !== 'adult,woman' || input.adult !== true || input.woman !== true) {
    return res.status(400).json({ error: 'attestation_required' });
  }
  try {
    const member = await getSession(req);
    if (!member) return res.status(401).json({ error: 'sign_in_required' });
    await withKittyDatabase(client => client.query(`
      update kitty_private.members
      set adult_attested_at = coalesce(adult_attested_at, now()),
          women_only_attested_at = coalesce(women_only_attested_at, now())
      where id = $1 and deleted_at is null
    `, [member.id]));
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ error: 'attestation_unavailable' });
  }
}
