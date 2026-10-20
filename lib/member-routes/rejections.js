import { withKittyDatabase } from '../db.js';
import { json, memberForRequest } from '../member-api.js';
import { activeGroup } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { active: true });
  if (!member) return;
  try {
    const result = await withKittyDatabase(async client => {
      const group = await activeGroup(client, req.query?.groupId, member.id, { host: true });
      const { rows } = await client.query(`
        select r.id,r.member_id,m.display_name,r.reapply_after,r.decided_at
        from kitty_private.join_requests r
        join kitty_private.members m on m.id=r.member_id and m.deleted_at is null
        where r.group_id=$1 and r.status='declined' and r.reapply_after>now()
        order by r.decided_at desc limit 30
      `, [group.id]);
      return rows.map(r => ({ id: r.id, memberId: r.member_id, name: r.display_name, reapplyAfter: r.reapply_after, decidedAt: r.decided_at }));
    });
    return json(res, 200, { requests: result });
  } catch (error) {
    if (error.message === 'invalid_group') return json(res, 400, { error: error.message });
    if (['not_group_member','host_required'].includes(error.message)) return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'rejections_unavailable' });
  }
}
