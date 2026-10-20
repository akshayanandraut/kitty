export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function activeGroup(client, groupId, actorId, { lock = false, host = false } = {}) {
  if (!uuid.test(groupId || '')) throw new Error('invalid_group');
  const { rows } = await client.query(`
    select g.id,g.title,g.description,g.public_city,g.public_area,g.public_latitude,g.visibility,g.member_limit,g.rules,
           g.avg_monthly_cost_paise,g.expense_split_basis,gm.role
    from kitty_private.groups g
    join kitty_private.group_memberships gm on gm.group_id=g.id and gm.member_id=$2 and gm.status='active'
    join kitty_private.members m on m.id=gm.member_id and m.deleted_at is null
      and m.identity_status='verified' and m.access_status='active'
    where g.id=$1 and g.deleted_at is null
    ${lock ? 'for update of g' : ''}
  `, [groupId, actorId]);
  if (!rows[0]) throw new Error('not_group_member');
  if (host && rows[0].role !== 'host') throw new Error('host_required');
  return rows[0];
}

export function splitEvenly(amountPaise, memberIds) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1 || amountPaise > 1_000_000_000) throw new Error('invalid_amount');
  if (!Array.isArray(memberIds) || memberIds.length < 2 || memberIds.length > 100 || new Set(memberIds).size !== memberIds.length || memberIds.some(x => !uuid.test(x))) throw new Error('invalid_participants');
  if (amountPaise < memberIds.length) throw new Error('invalid_amount');
  const ids = [...memberIds].sort();
  const base = Math.floor(amountPaise / ids.length);
  const remainder = amountPaise % ids.length;
  return ids.map((memberId, index) => ({ memberId, amountPaise: base + (index < remainder ? 1 : 0) }));
}
