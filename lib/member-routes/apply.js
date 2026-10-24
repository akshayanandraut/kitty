import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { currentKyc } from '../auth.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try { input = jsonBody(req); if (!uuid.test(input.groupId || '') || input.shareProfile !== true) throw new Error('invalid_application'); }
  catch { return json(res, 400, { error: 'invalid_application' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: groups } = await client.query(
          'select id,visibility,member_limit,faith_focus,community_space from kitty_private.groups where id=$1 and deleted_at is null for update',
          [input.groupId],
        );
        if (!groups[0] || groups[0].visibility !== 'discoverable') throw new Error('group_unavailable');
        const affinity = groups[0].faith_focus !== 'any' || groups[0].community_space !== 'all';
        if (affinity && input.confirmAudience !== true) throw new Error('audience_confirmation_required');
        const { rows: applicantRows } = await client.query(
          'select display_name,profile_bio,instagram_handle,facebook_handle,snapchat_handle,face_photo_key,whatsapp_verified_at,identity_status,identity_checked_at,identity_expires_at,identity_version,identity_consent_version,access_status from kitty_private.members where id=$1 and deleted_at is null for update',
          [member.id],
        );
        const applicant = applicantRows[0];
        if (!applicant || !currentKyc(applicant) || applicant.access_status !== 'active') throw new Error('membership_not_ready');
        if (!applicant.face_photo_key || !applicant.whatsapp_verified_at) throw new Error('profile_not_ready');
        const { rows: existing } = await client.query(
          "select exists(select 1 from kitty_private.group_memberships where group_id=$1 and member_id=$2 and status='active') as member, exists(select 1 from kitty_private.join_requests where group_id=$1 and member_id=$2 and status in ('requested','waitlisted')) as open, exists(select 1 from kitty_private.join_requests where group_id=$1 and member_id=$2 and status='declined' and reapply_after>now()) as cooldown",
          [input.groupId, member.id],
        );
        if (existing[0].member || existing[0].open) throw new Error('already_applied');
        if (existing[0].cooldown) throw new Error('reapply_cooldown');
        const { rows: blocked } = await client.query(
          "select exists(select 1 from kitty_private.blocks b join kitty_private.group_memberships gm on gm.group_id=$1 and gm.status='active' and (gm.member_id=b.actor_id or gm.member_id=b.target_id) where (b.actor_id=$2 or b.target_id=$2)) as blocked",
          [input.groupId, member.id],
        );
        if (blocked[0].blocked) throw new Error('group_unavailable');
        const { rows: voters } = await client.query(
          "select gm.member_id from kitty_private.group_memberships gm join kitty_private.members m on m.id=gm.member_id where gm.group_id=$1 and gm.status='active' and m.deleted_at is null and m.identity_status='verified' and m.identity_checked_at is not null and m.identity_expires_at>now() and nullif(m.identity_version,'') is not null and nullif(m.identity_consent_version,'') is not null and m.access_status='active' order by gm.member_id",
          [input.groupId],
        );
        if (!voters.length) throw new Error('no_verified_voters');
        const { rows: countRows } = await client.query(
          "select count(*)::int as n from kitty_private.group_memberships where group_id=$1 and status='active'",
          [input.groupId],
        );
        const status = countRows[0].n >= groups[0].member_limit ? 'waitlisted' : 'requested';
        const snapshot = { name: applicant.display_name, bio: applicant.profile_bio, socials: { instagram: applicant.instagram_handle, facebook: applicant.facebook_handle, snapchat: applicant.snapchat_handle }, photoKey: applicant.face_photo_key, whatsappVerified: true };
        const { rows: requests } = await client.query(
          'insert into kitty_private.join_requests(group_id,member_id,status,profile_share_consent_at,audience_confirmed_at,review_profile) values($1,$2,$3,now(),case when $4::boolean then now() else null end,$5::jsonb) returning id,status',
          [input.groupId, member.id, status, affinity, JSON.stringify(snapshot)],
        );
        for (const voter of voters) await client.query(
          'insert into kitty_private.join_vote_electorate(request_id,voter_id) values($1,$2)',
          [requests[0].id, voter.member_id],
        );
        await client.query('insert into kitty_private.audit_log(group_id,actor_id,action,details) values($1,$2,$3,$4::jsonb)', [input.groupId, member.id, 'join_requested', JSON.stringify({ requestId: requests[0].id })]);
        await client.query('commit');
        return { id: requests[0].id, status, requiredVotes: Math.ceil(voters.length / 2) };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 201, { request: result });
  } catch (error) {
    if (['membership_not_ready', 'profile_not_ready', 'reapply_cooldown', 'audience_confirmation_required'].includes(error.message)) return json(res, 403, { error: error.message });
    if (error.message === 'already_applied') return json(res, 409, { error: error.message });
    return json(res, 503, { error: 'application_unavailable' });
  }
}
