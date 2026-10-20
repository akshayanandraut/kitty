import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    input.reason = shortText(input.reason, 300);
    if (!uuid.test(input.requestId || '') || !input.reason) throw new Error('invalid_override');
  } catch { return json(res, 400, { error: 'invalid_override' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: requests } = await client.query(`
          select r.id,r.group_id,r.member_id,r.status,r.reapply_after,g.member_limit
          from kitty_private.join_requests r
          join kitty_private.groups g on g.id=r.group_id and g.deleted_at is null
          where r.id=$1 for update of r,g
        `, [input.requestId]);
        const request = requests[0];
        if (!request || request.status !== 'declined' || !request.reapply_after || request.reapply_after <= new Date()) throw new Error('override_not_applicable');
        const { rows: hosts } = await client.query(`
          select 1 from kitty_private.group_memberships
          where group_id=$1 and member_id=$2 and status='active' and role='host'
        `, [request.group_id, member.id]);
        if (!hosts[0]) throw new Error('host_required');
        const { rows: applicants } = await client.query(`
          select 1 from kitty_private.members where id=$1 and deleted_at is null
            and identity_status='verified' and access_status='active'
            and face_photo_key is not null and whatsapp_verified_at is not null
        `, [request.member_id]);
        if (!applicants[0]) throw new Error('applicant_not_ready');
        const { rows: blocks } = await client.query(`
          select exists(select 1 from kitty_private.blocks b
            join kitty_private.group_memberships gm on gm.group_id=$1 and gm.status='active'
              and (gm.member_id=b.actor_id or gm.member_id=b.target_id)
            where (b.actor_id=$2 or b.target_id=$2)) as blocked
        `, [request.group_id, request.member_id]);
        if (blocks[0].blocked) throw new Error('group_unavailable');
        const { rows: capacity } = await client.query(`
          select count(*)::int as members from kitty_private.group_memberships where group_id=$1 and status='active'
        `, [request.group_id]);
        if (capacity[0].members >= request.member_limit) throw new Error('group_full');
        await client.query(`insert into kitty_private.group_memberships(group_id,member_id,role,status) values($1,$2,'member','active')`, [request.group_id, request.member_id]);
        await client.query(`insert into kitty_private.host_cycle_participants(cycle_id,member_id)
          select id,$2 from kitty_private.host_cycles where group_id=$1 and status='active' on conflict do nothing`, [request.group_id, request.member_id]);
        await client.query(`update kitty_private.join_requests set status='approved',override_by=$2,
          override_reason=$3,override_at=now(),reapply_after=null where id=$1`, [request.id, member.id, input.reason]);
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'join_rejection_overridden',$3::jsonb)`, [request.group_id, member.id, JSON.stringify({ requestId: request.id, reason: input.reason })]);
        await client.query('commit');
        return { id: request.id, status: 'approved' };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { request: result });
  } catch (error) {
    if (['override_not_applicable', 'group_full'].includes(error.message)) return json(res, 409, { error: error.message });
    if (['host_required', 'applicant_not_ready'].includes(error.message)) return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'override_unavailable' });
  }
}
