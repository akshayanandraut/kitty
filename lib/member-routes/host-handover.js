import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { activeGroup, uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: req.method === 'POST', active: true });
  if (!member) return;
  let input;
  try {
    input = req.method === 'POST' ? jsonBody(req) : req.query;
    if (!uuid.test(input?.groupId || '')) throw new Error('invalid_group');
    if (req.method === 'POST' && !['offer', 'accept', 'decline', 'cancel'].includes(input.action)) throw new Error('invalid_action');
    if (req.method === 'POST' && !uuid.test(input.action === 'offer' ? input.targetId : input.offerId)) throw new Error('invalid_target');
  } catch { return json(res, 400, { error: 'invalid_handover' }); }

  try {
    const result = await withKittyDatabase(async client => {
      if (req.method === 'GET') {
        await activeGroup(client, input.groupId, member.id);
        const { rows } = await client.query(`
          select id,offered_by,offered_to,created_at,expires_at
          from kitty_private.host_handover_offers
          where group_id=$1 and status='pending' and expires_at>now()
            and (offered_by=$2 or offered_to=$2)
          order by created_at desc limit 20
        `, [input.groupId, member.id]);
        return { offers: rows.map(row => ({ id: row.id, offeredBy: row.offered_by, offeredTo: row.offered_to, createdAt: row.created_at, expiresAt: row.expires_at })) };
      }
      await client.query('begin');
      try {
        const group = await activeGroup(client, input.groupId, member.id, { lock: true });
        let event;
        if (input.action === 'offer') {
          if (group.role !== 'host' || input.targetId === member.id) throw new Error('host_required');
          const { rows: targets } = await client.query(`
            select gm.member_id from kitty_private.group_memberships gm
            join kitty_private.members m on m.id=gm.member_id and m.deleted_at is null
              and m.identity_status='verified' and m.access_status='active'
            where gm.group_id=$1 and gm.member_id=$2 and gm.status='active' and gm.role='member'
          `, [group.id, input.targetId]);
          if (!targets[0]) throw new Error('target_not_member');
          await client.query(`
            update kitty_private.host_handover_offers set status='cancelled',decided_at=now()
            where group_id=$1 and offered_to=$2 and status='pending' and expires_at<=now()
          `, [group.id, input.targetId]);
          const { rows: offers } = await client.query(`
            insert into kitty_private.host_handover_offers(group_id,offered_by,offered_to,status,expires_at)
            values($1,$2,$3,'pending',now()+interval '14 days') returning id
          `, [group.id, member.id, input.targetId]);
          event = { action: 'host_handover_offered', offerId: offers[0].id, targetId: input.targetId };
        } else {
          const { rows: offers } = await client.query(`
            select id,offered_by,offered_to from kitty_private.host_handover_offers
            where id=$1 and group_id=$2 and status='pending' and expires_at>now() for update
          `, [input.offerId, group.id]);
          const offer = offers[0];
          if (!offer) throw new Error('offer_unavailable');
          if (input.action === 'cancel') {
            if (offer.offered_by !== member.id) throw new Error('offer_forbidden');
            await client.query(`update kitty_private.host_handover_offers set status='cancelled',decided_at=now() where id=$1`, [offer.id]);
            event = { action: 'host_handover_cancelled', offerId: offer.id };
          } else {
            if (offer.offered_to !== member.id) throw new Error('offer_forbidden');
            const { rows: hosts } = await client.query(`
              select 1 from kitty_private.group_memberships
              where group_id=$1 and member_id=$2 and status='active' and role='host'
            `, [group.id, offer.offered_by]);
            if (!hosts[0]) throw new Error('offer_unavailable');
            if (input.action === 'accept') {
              const { rowCount } = await client.query(`
                update kitty_private.group_memberships set role='host'
                where group_id=$1 and member_id=$2 and status='active' and role='member'
              `, [group.id, member.id]);
              if (rowCount !== 1) throw new Error('offer_unavailable');
            }
            await client.query(`
              update kitty_private.host_handover_offers set status=$2,decided_at=now() where id=$1
            `, [offer.id, input.action === 'accept' ? 'accepted' : 'declined']);
            event = { action: input.action === 'accept' ? 'host_handover_accepted' : 'host_handover_declined', offerId: offer.id };
          }
        }
        await client.query(`
          insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,$3,$4::jsonb)
        `, [group.id, member.id, event.action, JSON.stringify(event)]);
        await client.query('commit');
        return { status: event.action, offerId: event.offerId };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, result);
  } catch (error) {
    if (['invalid_group','invalid_action','invalid_target'].includes(error.message)) return json(res, 400, { error: error.message });
    if (['not_group_member','host_required','offer_forbidden'].includes(error.message)) return json(res, 403, { error: error.message });
    if (['target_not_member','offer_unavailable'].includes(error.message)) return json(res, 409, { error: error.message });
    if (error.code === '23505') return json(res, 409, { error: 'offer_already_pending' });
    return json(res, 503, { error: 'handover_unavailable' });
  }
}
