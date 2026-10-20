import { exactOrigin, getSession } from './auth.js';

export function json(res, status, value) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(value);
}

export async function memberForRequest(req, res, { write = false, active = false } = {}) {
  if (write && !exactOrigin(req)) { json(res, 403, { error: 'origin_denied' }); return null; }
  let member;
  try { member = await getSession(req); }
  catch { json(res, 503, { error: 'session_unavailable' }); return null; }
  if (!member) { json(res, 401, { error: 'sign_in_required' }); return null; }
  if (active && (!member.adultAttested || !member.womenOnlyAttested || member.identityStatus !== 'verified' || member.accessStatus !== 'active')) {
    json(res, 403, { error: 'membership_not_ready' });
    return null;
  }
  return member;
}

export function jsonBody(req, maxBytes = 8192) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('invalid_body');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw) > maxBytes) throw new Error('body_too_large');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_body');
  return value;
}

export const shortText = (value, max) => {
  if (typeof value !== 'string') throw new Error('invalid_text');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error('invalid_text');
  return trimmed;
};
