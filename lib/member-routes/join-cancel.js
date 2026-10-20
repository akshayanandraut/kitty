import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true });
  if (!member) return;
  let input;
  try { input = jsonBody(req); if (!uuid.test(input.requestId || '')) throw new Error('invalid_request'); }
  catch { return json(res, 400, { error: 'invalid_request' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows } = await client.query(`
          update kitty_private.join_requests set status='cancelled',review_profile=null,decided_at=now()
          where id=$1 and member_id=$2 and status in ('requested','waitlisted')
          returning id,group_id
        `, [input.requestId, member.id]);
        if (rows[0]) await client.query('insert into kitty_private.audit_log(group_id,actor_id,action,details) values($1,$2,$3,$4::jsonb)', [rows[0].group_id, member.id, 'join_withdrawn', JSON.stringify({ requestId: rows[0].id })]);
        await client.query('commit');
        return rows[0] ? { id: rows[0].id, status: 'cancelled' } : null;
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    if (!result) return json(res, 404, { error: 'request_not_found' });
    return json(res, 200, { request: result });
  } catch { return json(res, 503, { error: 'withdrawal_unavailable' }); }
}
