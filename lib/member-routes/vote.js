import { withKittyDatabase } from '../db.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { write: true, active: true });
  if (!member) return;
  let input;
  try { input = jsonBody(req); if (!uuid.test(input.requestId || '') || typeof input.approve !== 'boolean') throw new Error('invalid_vote'); }
  catch { return json(res, 400, { error: 'invalid_vote' }); }
  try {
    const result = await withKittyDatabase(async client => {
      await client.query('begin');
      try {
        const { rows: requests } = await client.query(`
          select r.id,r.group_id,r.member_id,r.status,g.member_limit
          from kitty_private.join_requests r join kitty_private.groups g on g.id=r.group_id and g.deleted_at is null
          where r.id=$1 for update of r,g
        `, [input.requestId]);
        const request = requests[0];
        if (!request || !['requested','waitlisted'].includes(request.status)) throw new Error('request_stale');
        const { rows: voters } = await client.query(`
          select 1 from kitty_private.join_vote_electorate e
          join kitty_private.group_memberships gm on gm.group_id=$2 and gm.member_id=e.voter_id and gm.status='active'
          join kitty_private.members m on m.id=e.voter_id and m.deleted_at is null
            and m.identity_status='verified' and m.access_status='active'
          where e.request_id=$1 and e.voter_id=$3
        `, [request.id, request.group_id, member.id]);
        if (!voters[0]) throw new Error('not_eligible_to_vote');
        const { rowCount } = await client.query(`
          insert into kitty_private.join_votes(request_id,voter_id,approve)
          values($1,$2,$3) on conflict do nothing
        `, [request.id, member.id, input.approve]);
        if (!rowCount) throw new Error('already_voted');
        const { rows: totals } = await client.query(`
          select count(*)::int as electorate,
                 count(v.voter_id)::int as votes,
                 count(v.voter_id) filter (where v.approve)::int as yes_votes
          from kitty_private.join_vote_electorate e
          left join kitty_private.join_votes v on v.request_id=e.request_id and v.voter_id=e.voter_id
          where e.request_id=$1
        `, [request.id]);
        const tally = totals[0];
        const requiredVotes = Math.ceil(tally.electorate / 2);
        let status = request.status;
        if (tally.yes_votes >= requiredVotes) {
          const { rows: applicants } = await client.query(`
            select 1 from kitty_private.members where id=$1 and deleted_at is null
              and adult_attested_at is not null and women_only_attested_at is not null
              and identity_status='verified' and access_status='active'
              and face_photo_key is not null and whatsapp_verified_at is not null
          `, [request.member_id]);
          const { rows: blocked } = await client.query(`
            select exists(select 1 from kitty_private.blocks b
              join kitty_private.group_memberships gm on gm.group_id=$1 and gm.status='active'
                and (gm.member_id=b.actor_id or gm.member_id=b.target_id)
              where (b.actor_id=$2 or b.target_id=$2)) as blocked
          `, [request.group_id, request.member_id]);
          const { rows: capacity } = await client.query(`
            select count(*)::int as members from kitty_private.group_memberships where group_id=$1 and status='active'
          `, [request.group_id]);
          if (!applicants[0]) status = 'cancelled';
          else if (blocked[0].blocked) status = 'declined';
          else if (capacity[0].members >= request.member_limit) status = 'waitlisted';
          else {
            await client.query(`insert into kitty_private.group_memberships(group_id,member_id,role,status) values($1,$2,'member','active')`, [request.group_id, request.member_id]);
            await client.query(`insert into kitty_private.host_cycle_participants(cycle_id,member_id)
              select id,$2 from kitty_private.host_cycles where group_id=$1 and status='active' on conflict do nothing`, [request.group_id, request.member_id]);
            status = 'approved';
          }
        } else if (tally.votes === tally.electorate) status = 'declined';
        if (status !== request.status || ['approved','declined','cancelled'].includes(status)) {
          await client.query(`update kitty_private.join_requests set status=$2,
            decided_at=case when $2 in ('approved','declined','cancelled') then now() else decided_at end,
            decided_by=case when $2 in ('approved','declined','cancelled') then $3 else decided_by end,
            reapply_after=case when $2='declined' then now()+interval '3 months' else reapply_after end,
            review_profile=case when $2 in ('approved','declined','cancelled') then null else review_profile end
            where id=$1`, [request.id, status, member.id]);
        }
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,'join_vote_cast',$3::jsonb)`, [request.group_id, member.id, JSON.stringify({ requestId: request.id, status, approve: input.approve })]);
        await client.query('commit');
        return { status, votes: tally.votes, yesVotes: tally.yes_votes, requiredVotes };
      } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    });
    return json(res, 200, { review: result });
  } catch (error) {
    if (error.message === 'already_voted' || error.message === 'request_stale') return json(res, 409, { error: error.message });
    if (error.message === 'not_eligible_to_vote') return json(res, 403, { error: error.message });
    return json(res, 503, { error: 'vote_unavailable' });
  }
}
