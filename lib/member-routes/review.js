import { withKittyDatabase } from '../db.js';
import { json, memberForRequest } from '../member-api.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const member = await memberForRequest(req, res, { active: true });
  if (!member) return;
  if (!uuid.test(req.query?.groupId || '')) return json(res, 400, { error: 'invalid_group' });
  try {
    const { rows } = await withKittyDatabase(client => client.query(`
      select r.id, r.status, r.created_at, r.review_profile,
             count(e.voter_id)::int as electorate,
             count(v.voter_id)::int as votes,
             count(v.voter_id) filter (where v.approve)::int as yes_votes,
             bool_or(e.voter_id=$2) as may_vote,
             bool_or(v.voter_id=$2) as voted
      from kitty_private.join_requests r
      join kitty_private.group_memberships gm on gm.group_id=r.group_id and gm.member_id=$2 and gm.status='active'
      join kitty_private.join_vote_electorate e on e.request_id=r.id
      left join kitty_private.join_votes v on v.request_id=e.request_id and v.voter_id=e.voter_id
      where r.group_id=$1 and r.status in ('requested','waitlisted') and r.profile_share_consent_at is not null
        and exists(select 1 from kitty_private.join_vote_electorate mine where mine.request_id=r.id and mine.voter_id=$2)
      group by r.id order by r.created_at limit 50
    `, [req.query.groupId, member.id]));
    return json(res, 200, { requests: rows.map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, profile: { name: r.review_profile?.name, bio: r.review_profile?.bio, socials: r.review_profile?.socials, hasPhoto: Boolean(r.review_profile?.photoKey), photoUrl: r.review_profile?.photoKey ? `/api/account/photo?requestId=${r.id}` : null, whatsappVerified: r.review_profile?.whatsappVerified === true }, votes: r.votes, yesVotes: r.yes_votes, requiredVotes: Math.ceil(r.electorate / 2), mayVote: r.may_vote && !r.voted })) });
  } catch { return json(res, 503, { error: 'reviews_unavailable' }); }
}
