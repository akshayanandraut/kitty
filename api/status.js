import { kittyDatabaseReady } from '../lib/db.js';
import { clientId } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  let database = false;
  try { database = await kittyDatabaseReady(); } catch { /* report unavailable without internals */ }
  return res.status(200).json({
    mode: 'hosted_preview',
    database,
    sso: Boolean(clientId()),
    verification: false,
    payments: false,
    groups: false,
    price: { amountPaise: 69900, currency: 'INR', schedule: 'one_time', access: 'lifetime_after_activation' },
  });
}
