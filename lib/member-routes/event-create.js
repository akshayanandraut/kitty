import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';
import { activeGroup } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    input.title = shortText(input.title, 120);
    input.theme = shortText(input.theme || '', 160);
    input.location = shortText(input.location || '', 300);
    input.reservation = shortText(input.reservation || '', 500);
    input.timezone = shortText(input.timezone || 'Asia/Kolkata', 80);
    if (!input.title || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 100) throw new Error('invalid_event');
    const date = new Date(input.startsAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 10 * 60_000) throw new Error('invalid_event');
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
    input.startsAt = date.toISOString();
  } catch { return json(res, 400, { error: 'invalid_event' }); }
  try {
    const event = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const group = await activeGroup(client, input.groupId, member.id, { lock: true });
        if (input.capacity > group.member_limit) throw new Error('invalid_capacity');
        const { rows: cycles } = await client.query(`select id from kitty_private.host_cycles where group_id=$1 and status='active'`, [group.id]);
        const { rows } = await client.query(`
          insert into kitty_private.events(group_id,cycle_id,host_member_id,title,theme,starts_at,timezone,
            private_location,private_reservation,scope,capacity,status)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,'group',$10,'scheduled') returning id,title,starts_at
        `, [group.id, cycles[0]?.id || null, member.id, input.title, input.theme, input.startsAt, input.timezone, input.location, input.reservation, input.capacity]);
        await client.query('insert into kitty_private.audit_log(group_id,actor_id,action,details) values($1,$2,$3,$4::jsonb)', [group.id, member.id, 'event_created', JSON.stringify({ eventId: rows[0].id })]);
        await client.query('commit');
        return { id: rows[0].id, title: rows[0].title, startsAt: rows[0].starts_at };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 201, { event });
  } catch (error) {
    if (['invalid_group', 'invalid_capacity'].includes(error.message)) return json(res, 400, { error: error.message });
    if (error.message === 'not_group_member') return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'event_unavailable' });
  }
}
