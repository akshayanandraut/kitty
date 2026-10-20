import { withKittyDatabase } from '../db.js';
import { bishiEnabled, drawWinner, newDrawSeed, scheduledRound } from '../bishi.js';
import { json, jsonBody, memberForRequest } from '../member-api.js';
import { activeGroup, uuid } from './group-shared.js';

const actions = new Set(['propose','consent','activate','report_contribution','confirm_contribution','draw','report_payout','confirm_payout']);
const isoDate = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);

async function addRound(client, plan, roundNumber, participants) {
  const seed = newDrawSeed();
  const date = scheduledRound(isoDate(plan.starts_on), plan.cadence, roundNumber - 1);
  const { rows } = await client.query(`insert into kitty_private.bishi_rounds
    (plan_id,round_number,scheduled_for,seed_commitment,seed_secret)
    values($1,$2,$3,$4,$5) returning id`, [plan.id, roundNumber, date, seed.commitment, seed.secret]);
  for (const memberId of participants) await client.query(`insert into kitty_private.bishi_contributions(round_id,member_id,amount_paise)
    values($1,$2,$3)`, [rows[0].id, memberId, plan.amount_paise]);
  return { id: rows[0].id, commitment: seed.commitment, scheduledFor: date };
}

async function readBishi(client, groupId) {
  const { rows: plans } = await client.query(`select id,amount_paise,cadence,starts_on,status,created_at,activated_at
    from kitty_private.bishi_plans where group_id=$1 order by created_at desc limit 1`, [groupId]);
  const plan = plans[0];
  if (!plan) return { plan: null };
  const { rows: participants } = await client.query(`select p.member_id,p.consented_at,m.display_name
    from kitty_private.bishi_participants p join kitty_private.members m on m.id=p.member_id
    where p.plan_id=$1 order by p.member_id`, [plan.id]);
  const { rows: rounds } = await client.query(`select r.id,r.round_number,r.scheduled_for,r.status,r.seed_commitment,
    case when r.status='drawn' then r.seed_secret else null end as revealed_seed,
    r.winner_member_id,r.drawn_at,p.reported_amount_paise,p.recipient_confirmed_at
    from kitty_private.bishi_rounds r left join kitty_private.bishi_payouts p on p.round_id=r.id
    where r.plan_id=$1 order by r.round_number`, [plan.id]);
  const ids = rounds.map(r => r.id);
  const { rows: contributions } = ids.length ? await client.query(`select round_id,member_id,amount_paise,
    reported_at,confirmed_at from kitty_private.bishi_contributions where round_id=any($1::uuid[])`, [ids]) : { rows:[] };
  return {
    plan: { id:plan.id,amountPaise:Number(plan.amount_paise),cadence:plan.cadence,startsOn:isoDate(plan.starts_on),status:plan.status,
      participants:participants.map(p => ({ memberId:p.member_id,name:p.display_name,consented:Boolean(p.consented_at) })),
      rounds:rounds.map(r => ({ id:r.id,number:r.round_number,scheduledFor:isoDate(r.scheduled_for),status:r.status,
        commitment:r.seed_commitment,revealedSeed:r.revealed_seed,winnerId:r.winner_member_id,drawnAt:r.drawn_at,
        poolTargetPaise:Number(plan.amount_paise)*participants.length,reportedPayoutPaise:r.reported_amount_paise === null ? null : Number(r.reported_amount_paise),
        payoutConfirmed:Boolean(r.recipient_confirmed_at),
        contributions:contributions.filter(c => c.round_id===r.id).map(c => ({ memberId:c.member_id,amountPaise:Number(c.amount_paise),reported:Boolean(c.reported_at),confirmed:Boolean(c.confirmed_at) })) })) },
  };
}

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return json(res, 405, { error:'method_not_allowed' });
  const member = await memberForRequest(req, res, { write:req.method==='POST', active:true });
  if (!member) return;
  if (!bishiEnabled()) return json(res, 503, { error:'bishi_not_available' });
  let input = req.query || {};
  if (req.method==='POST') {
    try {
      input = jsonBody(req);
      if (!actions.has(input.action)) throw new Error('invalid_action');
    } catch { return json(res, 400, { error:'invalid_action' }); }
  }
  try {
    const result = await withKittyDatabase(async client => {
      if (req.method==='GET') {
        const group = await activeGroup(client, input.groupId, member.id);
        return readBishi(client, group.id);
      }
      await client.query('begin');
      try {
        const group = await activeGroup(client, input.groupId, member.id, { lock:true });
        const { rows: plans } = await client.query(`select id,group_id,amount_paise,cadence,starts_on,status
          from kitty_private.bishi_plans where group_id=$1 and status in ('proposed','active')
          order by created_at desc limit 1 for update`, [group.id]);
        let plan = plans[0];
        let result;
        if (input.action==='propose') {
          if (plan) throw new Error('plan_exists');
          if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise<100 || input.amountPaise>1_000_000_000 ||
              !['weekly','fortnightly','monthly'].includes(input.cadence)) throw new Error('invalid_plan');
          const startsOn = scheduledRound(input.startsOn, input.cadence, 0);
          if (startsOn <= new Date().toISOString().slice(0,10)) throw new Error('invalid_plan');
          const { rows: people } = await client.query(`select gm.member_id,m.identity_status,m.access_status,m.deleted_at
            from kitty_private.group_memberships gm join kitty_private.members m on m.id=gm.member_id
            where gm.group_id=$1 and gm.status='active' order by gm.member_id`, [group.id]);
          if (people.length<2 || people.some(p => p.identity_status!=='verified' || p.access_status!=='active' || p.deleted_at)) throw new Error('participants_not_ready');
          const lastDate=scheduledRound(startsOn,input.cadence,people.length-1);
          const { rows: authorizations }=await client.query(`select 1 from kitty_private.bishi_authorizations
            where group_id=$1 and valid_until >= $2::date and valid_until >= current_date`, [group.id,lastDate]);
          if (!authorizations[0]) throw new Error('legal_clearance_required');
          const { rows } = await client.query(`insert into kitty_private.bishi_plans(group_id,amount_paise,cadence,starts_on,created_by)
            values($1,$2,$3,$4,$5) returning id`, [group.id,input.amountPaise,input.cadence,startsOn,member.id]);
          for (const p of people) await client.query(`insert into kitty_private.bishi_participants(plan_id,member_id) values($1,$2)`, [rows[0].id,p.member_id]);
          result={ planId:rows[0].id,status:'proposed',participants:people.length };
        } else {
          if (!plan) throw new Error('plan_unavailable');
          const { rows: participantRows } = await client.query(`select member_id,consented_at from kitty_private.bishi_participants
            where plan_id=$1 order by member_id`, [plan.id]);
          const participantIds=participantRows.map(p=>p.member_id);
          if (!participantIds.includes(member.id)) throw new Error('not_participant');
          if (input.action==='consent') {
            if (plan.status!=='proposed' || typeof input.agree!=='boolean') throw new Error('plan_closed');
            await client.query(`update kitty_private.bishi_participants set consented_at=$3
              where plan_id=$1 and member_id=$2`, [plan.id,member.id,input.agree ? new Date() : null]);
            result={ agreed:input.agree };
          } else if (input.action==='activate') {
            if (plan.status!=='proposed') throw new Error('plan_closed');
            const { rows: current } = await client.query(`select gm.member_id,m.identity_status,m.access_status,m.deleted_at
              from kitty_private.group_memberships gm join kitty_private.members m on m.id=gm.member_id
              where gm.group_id=$1 and gm.status='active' order by gm.member_id`, [group.id]);
            if (participantRows.some(p=>!p.consented_at) || current.length!==participantIds.length ||
                current.some((p,i)=>p.member_id!==participantIds[i] || p.identity_status!=='verified' || p.access_status!=='active' || p.deleted_at)) throw new Error('consent_incomplete');
            const lastDate=scheduledRound(isoDate(plan.starts_on),plan.cadence,participantIds.length-1);
            const { rows: authorizations } = await client.query(`select 1 from kitty_private.bishi_authorizations
              where group_id=$1 and valid_until >= $2::date and valid_until >= current_date`, [group.id,lastDate]);
            if (!authorizations[0]) throw new Error('legal_clearance_required');
            await client.query(`update kitty_private.bishi_plans set status='active',activated_at=now() where id=$1`, [plan.id]);
            await client.query(`update kitty_private.bishi_participants set joined_at=now() where plan_id=$1`, [plan.id]);
            result={ status:'active',firstRound:await addRound(client,plan,1,participantIds) };
          } else {
            if (plan.status!=='active' && !(['report_payout','confirm_payout'].includes(input.action) && plan.status==='completed')) throw new Error('plan_closed');
            if (!uuid.test(input.roundId||'')) throw new Error('invalid_round');
            const { rows: rounds } = await client.query(`select id,round_number,scheduled_for,status,
              seed_secret,seed_commitment,winner_member_id from kitty_private.bishi_rounds
              where id=$1 and plan_id=$2 for update`, [input.roundId,plan.id]);
            const round=rounds[0];
            if (!round) throw new Error('invalid_round');
            if (input.action==='report_contribution') {
              if (round.status!=='planned') throw new Error('round_closed');
              const { rowCount }=await client.query(`update kitty_private.bishi_contributions set reported_at=now()
                where round_id=$1 and member_id=$2 and reported_at is null`, [round.id,member.id]);
              if (!rowCount) throw new Error('already_reported');
              result={ reported:true };
            } else if (input.action==='confirm_contribution') {
              if (round.status!=='planned' || !uuid.test(input.memberId||'') || input.memberId===member.id) throw new Error('invalid_confirmation');
              const { rowCount }=await client.query(`update kitty_private.bishi_contributions
                set confirmed_at=now(),confirmed_by=$3 where round_id=$1 and member_id=$2
                and reported_at is not null and confirmed_at is null`, [round.id,input.memberId,member.id]);
              if (!rowCount) throw new Error('contribution_unavailable');
              result={ confirmed:true };
            } else if (input.action==='draw') {
              if (round.status!=='planned' || isoDate(round.scheduled_for)>new Date().toISOString().slice(0,10)) throw new Error('round_not_due');
              const { rows: totals }=await client.query(`select count(*)::int as total,
                count(confirmed_at)::int as confirmed from kitty_private.bishi_contributions where round_id=$1`, [round.id]);
              if (totals[0].total!==participantIds.length || totals[0].confirmed!==participantIds.length) throw new Error('pool_unconfirmed');
              const { rows: prior }=await client.query(`select winner_member_id from kitty_private.bishi_rounds
                where plan_id=$1 and status='drawn' order by round_number`, [plan.id]);
              const winnerId=drawWinner(round.seed_secret,round.seed_commitment,plan.id,round.round_number,participantIds,prior.map(p=>p.winner_member_id));
              await client.query(`update kitty_private.bishi_rounds set status='drawn',winner_member_id=$2,drawn_at=now() where id=$1`, [round.id,winnerId]);
              if (round.round_number<participantIds.length) await addRound(client,plan,round.round_number+1,participantIds);
              result={ winnerId,roundNumber:round.round_number,commitment:round.seed_commitment,revealedSeed:round.seed_secret };
            } else if (input.action==='report_payout') {
              if (round.status!=='drawn' || !Number.isSafeInteger(input.amountPaise) || input.amountPaise<100 || input.amountPaise>Number(plan.amount_paise)*participantIds.length) throw new Error('invalid_payout');
              const { rowCount }=await client.query(`insert into kitty_private.bishi_payouts(round_id,winner_member_id,reported_amount_paise)
                values($1,$2,$3) on conflict do nothing`, [round.id,round.winner_member_id,input.amountPaise]);
              if (!rowCount) throw new Error('payout_unavailable');
              result={ reported:true };
            } else if (input.action==='confirm_payout') {
              if (round.status!=='drawn' || round.winner_member_id!==member.id) throw new Error('recipient_required');
              const { rowCount }=await client.query(`update kitty_private.bishi_payouts set recipient_confirmed_at=now()
                where round_id=$1 and recipient_confirmed_at is null`, [round.id]);
              if (!rowCount) throw new Error('payout_unavailable');
              const { rows: completion }=await client.query(`select count(*)::int as rounds,
                count(p.recipient_confirmed_at)::int as confirmed from kitty_private.bishi_rounds r
                left join kitty_private.bishi_payouts p on p.round_id=r.id where r.plan_id=$1`, [plan.id]);
              if (completion[0].rounds===participantIds.length && completion[0].confirmed===participantIds.length)
                await client.query(`update kitty_private.bishi_plans set status='completed' where id=$1`, [plan.id]);
              result={ confirmed:true };
            }
          }
        }
        await client.query(`insert into kitty_private.audit_log(group_id,actor_id,action,details)
          values($1,$2,$3,$4::jsonb)`, [group.id,member.id,`bishi_${input.action}`,JSON.stringify({ planId:plan?.id || result.planId,roundId:input.roundId || null })]);
        await client.query('commit');
        return result;
      } catch (error) { await client.query('rollback').catch(()=>{}); throw error; }
    });
    return json(res, req.method==='GET' ? 200 : 200, result);
  } catch (error) {
    if (['invalid_group','invalid_plan','invalid_schedule','invalid_round','invalid_action','invalid_confirmation','invalid_payout'].includes(error.message)) return json(res,400,{ error:error.message });
    if (['not_group_member','not_participant'].includes(error.message)) return json(res,403,{ error:error.message });
    if (['plan_exists','plan_closed','plan_unavailable','participants_not_ready','consent_incomplete','legal_clearance_required','round_closed','round_not_due','pool_unconfirmed','already_reported','contribution_unavailable','payout_unavailable','recipient_required'].includes(error.message)) return json(res,409,{ error:error.message });
    return json(res,503,{ error:'bishi_unavailable' });
  }
}
