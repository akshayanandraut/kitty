import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';
import { activeGroup, splitEvenly, uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    input.title = shortText(input.title, 120);
    if (!input.title || !Number.isSafeInteger(input.amountPaise) || input.amountPaise < 1 || input.amountPaise > 1_000_000_000) throw new Error('invalid_expense');
    if (input.eventId && !uuid.test(input.eventId)) throw new Error('invalid_expense');
  } catch { return json(res, 400, { error: 'invalid_expense' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const group = await activeGroup(client, input.groupId, member.id, { lock: true });
        let people;
        if (group.expense_split_basis === 'attendees') {
          if (!input.eventId) throw new Error('event_required');
          const { rows: events } = await client.query(`
            select id from kitty_private.events where id=$1 and group_id=$2 and status in ('scheduled','completed')
          `, [input.eventId, group.id]);
          if (!events[0]) throw new Error('event_unavailable');
          const { rows } = await client.query(`
            select r.member_id,gm.status as membership_status,m.identity_status,m.access_status,m.deleted_at
            from kitty_private.event_rsvps r
            left join kitty_private.group_memberships gm on gm.group_id=$2 and gm.member_id=r.member_id and gm.status='active'
            left join kitty_private.members m on m.id=r.member_id
            where r.event_id=$1 and r.response='going'
            order by r.member_id
          `, [input.eventId, group.id]);
          people = rows;
        } else {
          if (input.eventId) throw new Error('event_not_applicable');
          const { rows } = await client.query(`
            select gm.member_id,gm.status as membership_status,m.identity_status,m.access_status,m.deleted_at
            from kitty_private.group_memberships gm
            left join kitty_private.members m on m.id=gm.member_id
            where gm.group_id=$1 and gm.status='active' order by gm.member_id
          `, [group.id]);
          people = rows;
        }
        if (people.some(p => p.membership_status !== 'active' || p.deleted_at || p.identity_status !== 'verified' || p.access_status !== 'active')) throw new Error('participants_not_ready');
        const shares = splitEvenly(input.amountPaise, people.map(p => p.member_id));
        const { rows: expenses } = await client.query(`
          insert into kitty_private.expenses(group_id,title,amount_paise,paid_by,created_by,event_id,split_basis,status)
          values($1,$2,$3,$4,$4,$5,$6,'proposed') returning id
        `, [group.id, input.title, input.amountPaise, member.id, input.eventId || null, group.expense_split_basis]);
        for (const share of shares) await client.query(`
          insert into kitty_private.expense_splits(expense_id,member_id,amount_paise) values($1,$2,$3)
        `, [expenses[0].id, share.memberId, share.amountPaise]);
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'expense_proposed',$3::jsonb)`, [group.id, member.id, JSON.stringify({ expenseId: expenses[0].id, participantCount: shares.length })]);
        await client.query('commit');
        return { id: expenses[0].id, status: 'proposed', shares };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 201, { expense: result });
  } catch (error) {
    if (['invalid_group','invalid_amount','invalid_participants','event_required','event_not_applicable','event_unavailable'].includes(error.message)) return json(res, 400, { error: error.message });
    if (error.message === 'not_group_member') return json(res, 403, { error: error.message });
    if (error.message === 'participants_not_ready') return json(res, 409, { error: error.message });
    return json(res, 503, { error: 'expense_unavailable' });
  }
}
