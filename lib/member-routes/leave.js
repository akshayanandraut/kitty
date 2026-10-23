import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    if (!uuid.test(input.groupId || '') || input.confirm !== true) throw new Error('confirmation_required');
  } catch { return json(res, 400, { error: 'confirmation_required' }); }

  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: groups } = await client.query(`
          select id from kitty_private.groups where id=$1 and deleted_at is null for update
        `, [input.groupId]);
        if (!groups[0]) throw new Error('group_not_found');
        const { rows: memberships } = await client.query(`
          select id,role from kitty_private.group_memberships
          where group_id=$1 and member_id=$2 and status='active' for update
        `, [input.groupId, member.id]);
        const membership = memberships[0];
        if (!membership) throw new Error('not_group_member');
        if (membership.role === 'host') {
          const { rows: hosts } = await client.query(`
            select count(*)::int as count from kitty_private.group_memberships
            where group_id=$1 and status='active' and role='host'
          `, [input.groupId]);
          if (hosts[0].count < 2) throw new Error('host_handover_required');
        }
        const { rows: plans } = await client.query(`
          select exists(select 1 from kitty_private.bishi_plans p
            join kitty_private.bishi_participants bp on bp.plan_id=p.id and bp.member_id=$2
            where p.group_id=$1 and p.status in ('proposed','active')) as open_plan
        `, [input.groupId, member.id]);
        if (plans[0].open_plan) throw new Error('bishi_plan_open');
        await client.query(`
          update kitty_private.group_memberships set status='left',left_at=now() where id=$1
        `, [membership.id]);
        await client.query(`
          update kitty_private.host_cycle_participants set departed_at=now()
          where member_id=$2 and departed_at is null and cycle_id in
            (select id from kitty_private.host_cycles where group_id=$1 and status='active')
        `, [input.groupId, member.id]);
        await client.query(`
          insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'member_left',$3::jsonb)
        `, [input.groupId, member.id, JSON.stringify({ membershipId: membership.id })]);
        await client.query('commit');
        return { groupId: input.groupId, status: 'left' };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { membership: result });
  } catch (error) {
    if (['host_handover_required','bishi_plan_open'].includes(error.message)) return json(res, 409, { error: error.message });
    if (error.message === 'not_group_member') return json(res, 403, { error: error.message });
    if (error.message === 'group_not_found') return json(res, 404, { error: error.message });
    return json(res, 503, { error: 'leave_unavailable' });
  }
}
