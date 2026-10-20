import { withKittyDatabase } from '../db.js';
import { json, memberForRequest } from '../member-api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res);
  if (!member) return;
  try {
    const result = await withKittyDatabase(async client => {
      const { rows: profiles } = await client.query(`
        select face_photo_key is not null as has_photo,whatsapp_verified_at is not null as whatsapp_verified
        from kitty_private.members where id=$1 and deleted_at is null
      `, [member.id]);
      const { rows: groups } = await client.query(`
        select g.id,g.title,g.public_city as city,g.avg_monthly_cost_paise,g.expense_split_basis,gm.role
        from kitty_private.group_memberships gm
        join kitty_private.groups g on g.id=gm.group_id and g.deleted_at is null
        where gm.member_id=$1 and gm.status='active'
        order by gm.joined_at desc limit 50
      `, [member.id]);
      const { rows: applications } = await client.query(`
        select r.id,r.group_id,g.title as group_title,r.status,r.created_at,r.reapply_after
        from kitty_private.join_requests r
        join kitty_private.groups g on g.id=r.group_id and g.deleted_at is null
        where r.member_id=$1 order by r.created_at desc limit 30
      `, [member.id]);
      return {
        profileReady: Boolean(profiles[0]?.has_photo && profiles[0]?.whatsapp_verified),
        hasPhoto: Boolean(profiles[0]?.has_photo),
        whatsappVerified: Boolean(profiles[0]?.whatsapp_verified),
        groups: groups.map(g => ({ id: g.id, title: g.title, city: g.city, role: g.role, avgMonthlyCostPaise: g.avg_monthly_cost_paise, expenseSplitBasis: g.expense_split_basis })),
        applications: applications.map(a => ({ id: a.id, groupId: a.group_id, groupTitle: a.group_title, status: a.status, createdAt: a.created_at, reapplyAfter: a.reapply_after })),
      };
    });
    return json(res, 200, result);
  } catch { return json(res, 503, { error: 'home_unavailable' }); }
}
