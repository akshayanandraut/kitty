import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';
import { activeGroup, uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    if (!uuid.test(input.expenseId || '') || typeof input.approve !== 'boolean') throw new Error('invalid_decision');
    input.reason = shortText(input.reason || '', 300);
    if (!input.approve && !input.reason) throw new Error('reason_required');
  } catch { return json(res, 400, { error: 'invalid_decision' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: expenseRows } = await client.query('select id,group_id from kitty_private.expenses where id=$1', [input.expenseId]);
        if (!expenseRows[0]) throw new Error('expense_unavailable');
        const expense = expenseRows[0];
        await activeGroup(client, expense.group_id, member.id, { lock: true });
        const { rows: locked } = await client.query('select id,status from kitty_private.expenses where id=$1 for update', [expense.id]);
        const status = locked[0].status;
        const { rows: shares } = await client.query('select 1 from kitty_private.expense_splits where expense_id=$1 and member_id=$2', [expense.id, member.id]);
        if (!shares[0]) throw new Error('not_expense_participant');
        if (input.approve) {
          if (status !== 'proposed') throw new Error('expense_closed');
          await client.query(`insert into kitty_private.expense_approvals(expense_id,member_id)
            values($1,$2) on conflict do nothing`, [expense.id, member.id]);
          const { rows: counts } = await client.query(`
            select (select count(*)::int from kitty_private.expense_splits where expense_id=$1) as participants,
                   (select count(*)::int from kitty_private.expense_approvals where expense_id=$1) as approvals
          `, [expense.id]);
          const agreed = counts[0].participants === counts[0].approvals;
          if (agreed) await client.query("update kitty_private.expenses set status='agreed',agreed_at=now() where id=$1", [expense.id]);
          await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
            values($1,$2,'expense_share_approved',$3::jsonb)`, [expense.group_id, member.id, JSON.stringify({ expenseId: expense.id })]);
          await client.query('commit');
          return { id: expense.id, status: agreed ? 'agreed' : 'proposed', approvals: counts[0].approvals, participants: counts[0].participants };
        }
        if (!['proposed','agreed'].includes(status)) throw new Error('expense_closed');
        await client.query("update kitty_private.expenses set status='disputed',agreed_at=null where id=$1", [expense.id]);
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'expense_share_disputed',$3::jsonb)`, [expense.group_id, member.id, JSON.stringify({ expenseId: expense.id, reason: input.reason })]);
        await client.query('commit');
        return { id: expense.id, status: 'disputed' };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { expense: result });
  } catch (error) {
    if (error.message === 'expense_closed') return json(res, 409, { error: error.message });
    if (['not_group_member','not_expense_participant'].includes(error.message)) return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'expense_unavailable' });
  }
}
