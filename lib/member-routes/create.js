import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest, shortText } from '../member-api.js';
import { publicAreaPin } from '../discovery.js';
import { groupOptions, groupTitle } from '../group-options.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try {
    input = jsonBody(req);
    input.title = groupTitle(input.title);
    Object.assign(input, groupOptions(input));
    input.description = shortText(input.description, 500);
    input.city = shortText(input.city, 80);
    input.area = shortText(input.area || '', 80);
    input.rules = shortText(input.rules || '', 2000);
    if (!input.title || !input.city || !Number.isInteger(input.limit) || input.limit < 2 || input.limit > 100) throw new Error('invalid_group');
    if (!Number.isSafeInteger(input.avgMonthlyCostPaise) || input.avgMonthlyCostPaise < 0 || input.avgMonthlyCostPaise > 1_000_000_000) throw new Error('invalid_group');
    if (!['private', 'discoverable'].includes(input.visibility) || !['members', 'attendees'].includes(input.expenseSplitBasis)) throw new Error('invalid_group');
    if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new Error('invalid_group');
    input.pin = input.latitude === undefined ? null : publicAreaPin(input.latitude, input.longitude);
    if (input.visibility === 'private' && input.pin) throw new Error('invalid_group');
  } catch { return json(res, 400, { error: 'invalid_group' }); }
  try {
    const group = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: owners } = await client.query(
          'select id from kitty_private.members where id=$1 and deleted_at is null and adult_attested_at is not null and women_only_attested_at is not null and identity_status=$2 and identity_checked_at is not null and identity_expires_at>now() and nullif(identity_version,\'\') is not null and nullif(identity_consent_version,\'\') is not null and access_status=$3 for update',
          [member.id, 'verified', 'active'],
        );
        if (!owners[0]) throw new Error('membership_not_ready');
        const { rows } = await client.query(
          'insert into kitty_private.groups(title,description,public_city,public_area,public_latitude,public_longitude,visibility,member_limit,rules,avg_monthly_cost_paise,expense_split_basis,created_by,faith_focus,community_space,region_focus,style_tags) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id,title',
          [input.title, input.description, input.city, input.area, input.pin?.latitude ?? null, input.pin?.longitude ?? null, input.visibility, input.limit, input.rules, input.avgMonthlyCostPaise, input.expenseSplitBasis, member.id, input.faithFocus, input.communitySpace, input.regionFocus, input.styleTags],
        );
        const groupId = rows[0].id;
        await client.query('insert into kitty_private.group_memberships(group_id,member_id,role,status) values($1,$2,$3,$4)', [groupId, member.id, 'host', 'active']);
        const { rows: cycles } = await client.query('insert into kitty_private.host_cycles(group_id,cycle_number,status) values($1,1,$2) returning id', [groupId, 'active']);
        await client.query('insert into kitty_private.host_cycle_participants(cycle_id,member_id) values($1,$2)', [cycles[0].id, member.id]);
        await client.query('insert into kitty_private.audit_log(group_id,actor_id,action) values($1,$2,$3)', [groupId, member.id, 'group_created']);
        await client.query('commit');
        return rows[0];
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 201, { group });
  } catch (error) {
    if (error.message === 'membership_not_ready') return json(res, 403, { error: 'membership_not_ready' });
    return json(res, 503, { error: 'group_unavailable' });
  }
}
