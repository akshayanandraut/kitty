import { withKittyDatabase } from '../db.js';
import { json, memberForRequest } from '../member-api.js';
import { activeGroup } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { active: true });
  if (!member) return;
  try {
    const result = await withKittyDatabase(async client => {
      const g = await activeGroup(client, req.query?.groupId, member.id);
      const { rows: members } = await client.query(`
        select gm.member_id,m.display_name,gm.role,gm.joined_at,
               (m.identity_status='verified' and m.access_status='active') as can_host
        from kitty_private.group_memberships gm join kitty_private.members m on m.id=gm.member_id
        where gm.group_id=$1 and gm.status='active' and m.deleted_at is null
        order by gm.joined_at
      `, [g.id]);
      const { rows: events } = await client.query(`
        select e.id,e.title,e.theme,e.starts_at,e.timezone,e.private_location,e.private_reservation,
               e.scope,e.capacity,e.status,e.host_member_id,r.response as my_rsvp,
               count(all_r.member_id) filter (where all_r.response='going')::int as going_count
        from kitty_private.events e
        left join kitty_private.event_rsvps r on r.event_id=e.id and r.member_id=$2
        left join kitty_private.event_rsvps all_r on all_r.event_id=e.id
        where e.group_id=$1
        group by e.id,r.response
        order by e.starts_at desc limit 30
      `, [g.id, member.id]);
      const { rows: expenses } = await client.query(`
        select e.id,e.title,e.amount_paise,e.paid_by,e.created_by,e.created_at,e.status,
               e.split_basis,e.event_id,e.agreed_at
        from kitty_private.expenses e where e.group_id=$1
        order by e.created_at desc limit 50
      `, [g.id]);
      const expenseIds = expenses.map(e => e.id);
      const { rows: splits } = expenseIds.length ? await client.query(`
        select s.expense_id,s.member_id,s.amount_paise,a.approved_at
        from kitty_private.expense_splits s
        left join kitty_private.expense_approvals a on a.expense_id=s.expense_id and a.member_id=s.member_id
        where s.expense_id=any($1::uuid[]) order by s.member_id
      `, [expenseIds]) : { rows: [] };
      return {
        group: { id: g.id, title: g.title, description: g.description, city: g.public_city, area: g.public_area, nearbyDiscoverable: g.public_latitude !== null, visibility: g.visibility, limit: g.member_limit, rules: g.rules, avgMonthlyCostPaise: g.avg_monthly_cost_paise, expenseSplitBasis: g.expense_split_basis, myRole: g.role },
        members: members.map(m => ({ id: m.member_id, name: m.display_name, role: m.role, joinedAt: m.joined_at, canHost: m.can_host })),
        events: events.map(e => ({ id: e.id, title: e.title, theme: e.theme, startsAt: e.starts_at, timezone: e.timezone, location: e.private_location, reservation: e.private_reservation, scope: e.scope, capacity: e.capacity, status: e.status, hostId: e.host_member_id, goingCount: e.going_count, myRsvp: e.my_rsvp })),
        expenses: expenses.map(e => ({ id: e.id, title: e.title, amountPaise: Number(e.amount_paise), paidBy: e.paid_by, createdBy: e.created_by, createdAt: e.created_at, status: e.status, splitBasis: e.split_basis, eventId: e.event_id, agreedAt: e.agreed_at, splits: splits.filter(s => s.expense_id === e.id).map(s => ({ memberId: s.member_id, amountPaise: Number(s.amount_paise), approved: Boolean(s.approved_at) })) })),
      };
    });
    return json(res, 200, result);
  } catch (error) {
    if (error.message === 'invalid_group') return json(res, 400, { error: error.message });
    if (error.message === 'not_group_member') return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'group_unavailable' });
  }
}
