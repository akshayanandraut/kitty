import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { activeGroup, uuid } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try { input = jsonBody(req); if (!uuid.test(input.eventId || '') || !['going','maybe','not_going'].includes(input.response)) throw new Error('invalid_rsvp'); }
  catch { return json(res, 400, { error: 'invalid_rsvp' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: eventRows } = await client.query('select id,group_id,capacity,status,starts_at from kitty_private.events where id=$1', [input.eventId]);
        const event = eventRows[0];
        if (!event) throw new Error('event_unavailable');
        await activeGroup(client, event.group_id, member.id, { lock: true });
        const { rows: locked } = await client.query('select id,capacity,status,starts_at from kitty_private.events where id=$1 for update', [event.id]);
        if (locked[0].status !== 'scheduled' || locked[0].starts_at <= new Date()) throw new Error('event_closed');
        const { rows: previous } = await client.query('select response from kitty_private.event_rsvps where event_id=$1 and member_id=$2', [event.id, member.id]);
        if (input.response === 'going' && previous[0]?.response !== 'going') {
          const { rows: counts } = await client.query("select count(*)::int as going from kitty_private.event_rsvps where event_id=$1 and response='going'", [event.id]);
          if (counts[0].going >= locked[0].capacity) throw new Error('event_full');
        }
        await client.query(`insert into kitty_private.event_rsvps(event_id,member_id,response)
          values($1,$2,$3) on conflict(event_id,member_id) do update set response=excluded.response,updated_at=now()`, [event.id, member.id, input.response]);
        await client.query('commit');
        return { eventId: event.id, response: input.response };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { rsvp: result });
  } catch (error) {
    if (['event_closed', 'event_full'].includes(error.message)) return json(res, 409, { error: error.message });
    if (error.message === 'not_group_member') return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'rsvp_unavailable' });
  }
}
