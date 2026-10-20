import { withKittyDatabase } from '../db.js';
import { publicAreaPin } from '../discovery.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';
import { activeGroup } from './group-shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    input.area = shortText(input.area || '', 80);
    input.pin = input.remove === true ? null : publicAreaPin(input.latitude, input.longitude);
  } catch { return json(res, 400, { error: 'invalid_location' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const group = await activeGroup(client, input.groupId, member.id, { lock: true, host: true });
        if (group.visibility !== 'discoverable' && input.pin) throw new Error('private_group');
        await client.query(`update kitty_private.groups
          set public_area=$2,public_latitude=$3,public_longitude=$4 where id=$1`,
          [group.id, input.area, input.pin?.latitude ?? null, input.pin?.longitude ?? null]);
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'public_area_updated',$3::jsonb)`,
          [group.id, member.id, JSON.stringify({ hasPin: Boolean(input.pin), area: input.area })]);
        await client.query('commit');
        return { area: input.area, nearbyDiscoverable: Boolean(input.pin) };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { location: result });
  } catch (error) {
    if (error.message === 'invalid_group') return json(res, 400, { error: error.message });
    if (error.message === 'private_group') return json(res, 409, { error: error.message });
    if (['not_group_member','host_required'].includes(error.message)) return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'location_unavailable' });
  }
}
