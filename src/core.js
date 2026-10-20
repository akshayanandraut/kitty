import { randomUUID } from 'node:crypto';

export class KittyError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new KittyError(code, status); };
const now = () => new Date().toISOString();
const id = () => randomUUID();
const required = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('invalid_text');
  return value.trim();
};
const integer = (value, min = 0, max = 1_000_000_000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_amount');
  return value;
};
const distinct = (values) => [...new Set(values)];
const member = (state, groupId, userId) => state.memberships.find(x => x.groupId === groupId && x.userId === userId && x.status === 'active');
const isHost = (state, groupId, userId) => member(state, groupId, userId)?.role === 'host';
const requireMember = (state, groupId, userId) => member(state, groupId, userId) || fail('not_group_member', 403);
const requireHost = (state, groupId, userId) => isHost(state, groupId, userId) || fail('host_required', 403);
const group = (state, groupId) => state.groups.find(x => x.id === groupId && !x.deletedAt) || fail('group_not_found', 404);
const activeCount = (state, groupId) => state.memberships.filter(x => x.groupId === groupId && x.status === 'active').length;
const blocked = (state, a, b) => state.blocks.some(x => (x.actorId === a && x.targetId === b) || (x.actorId === b && x.targetId === a));

export function initialState() {
  return { users: [], groups: [], memberships: [], joinRequests: [], joinVotes: [], invitations: [], events: [], cycles: [], contributions: [], expenses: [], settlements: [], reports: [], blocks: [], audit: [] };
}

export function createUser(state, { name, selfAttestedWoman, adultAttested, syntheticVerified = false, interests = [] }) {
  if (selfAttestedWoman !== true) fail('eligibility_attestation_required');
  if (adultAttested !== true) fail('adult_attestation_required');
  const user = { id: id(), name: required(name, 80), selfAttestedWoman: true, adultAttested: true, identityStatus: syntheticVerified === true ? 'verified' : 'not_started', profile: { bio: '', socials: {}, photoId: null, whatsappVerified: false }, interests: distinct(interests.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean)).slice(0, 12), createdAt: now(), contact: null, contactConsent: false, deletedAt: null };
  state.users.push(user); return user;
}

export function createGroup(state, actorId, input) {
  const user = state.users.find(x => x.id === actorId && !x.deletedAt);
  if (!user?.selfAttestedWoman) fail('eligibility_required', 403);
  const title = required(input.title, 80);
  const limit = integer(input.limit, 2, 100);
  const g = { id: id(), title, description: required(input.description, 500), city: required(input.city, 80), visibility: input.visibility === 'private' ? 'private' : 'discoverable', limit, rules: typeof input.rules === 'string' ? input.rules.trim().slice(0, 2000) : '', interestTags: distinct((input.interestTags || []).filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean)).slice(0, 8), avgMonthlyCostPaise: integer(input.avgMonthlyCostPaise ?? 0), expenseSplitBasis: input.expenseSplitBasis === 'attendees' ? 'attendees' : 'members', contribution: input.contribution || { amountPaise: 0, cadence: 'none' }, createdAt: now(), deletedAt: null };
  state.groups.push(g);
  state.memberships.push({ id: id(), groupId: g.id, userId: actorId, role: 'host', status: 'active', joinedAt: now() });
  state.cycles ||= [];
  state.cycles.push({ id: id(), groupId: g.id, number: 1, status: 'active', participants: [{ userId: actorId, joinedAt: now(), hostedEventId: null, exception: null, departedAt: null }], createdAt: now(), completedAt: null });
  state.audit.push({ at: now(), actorId, groupId: g.id, action: 'group_created' });
  return g;
}

export function discovery(state, actorId) {
  return state.groups.filter(g => g.visibility === 'discoverable' && !g.deletedAt && !state.memberships.some(m => m.groupId === g.id && blocked(state, actorId, m.userId))).map(g => ({ id: g.id, title: g.title, description: g.description, city: g.city, avgMonthlyCostPaise: g.avgMonthlyCostPaise || 0, expenseSplitBasis: g.expenseSplitBasis || 'members', interestTags: g.interestTags, limit: g.limit, members: activeCount(state, g.id), available: Math.max(0, g.limit - activeCount(state, g.id)) }));
}

export function openSessions(state, actorId) {
  const visible = new Map(discovery(state, actorId).map(g => [g.id, g]));
  return state.events.filter(e => e.scope === 'open' && e.status === 'scheduled' && e.startsAt > now() && visible.has(e.groupId)).map(e => {
    const g = visible.get(e.groupId);
    return { id: e.id, groupId: e.groupId, groupTitle: g.title, city: g.city, title: e.title, theme: e.theme, startsAt: e.startsAt, timezone: e.timezone, available: Math.max(0, Math.min(g.available, e.capacity - Object.values(e.rsvps).filter(x => x === 'going').length)) };
  });
}

export function suggestOpenSession(state, actorId, random = Math.random) {
  const sessions = openSessions(state, actorId).filter(e => e.available > 0);
  if (!sessions.length) return null;
  return sessions[Math.floor(random() * sessions.length)];
}

export function groupView(state, actorId, groupId) {
  const g = group(state, groupId);
  requireMember(state, groupId, actorId);
  const members = state.memberships.filter(x => x.groupId === groupId && x.status === 'active').map(x => {
    const u = state.users.find(y => y.id === x.userId);
    return { userId: x.userId, name: u?.name || 'Former member', role: x.role, contact: u?.contactConsent && !blocked(state, actorId, x.userId) ? u.contact : null };
  });
  const canReview = state.users.find(x => x.id === actorId)?.identityStatus === 'verified';
  const joinRequests = canReview ? state.joinRequests.filter(x => x.groupId === groupId && ['requested','waitlisted'].includes(x.status) && x.voterIds?.includes(actorId)).map(x => ({ ...x, votes: (state.joinVotes || []).filter(v => v.requestId === x.id).length, yesVotes: (state.joinVotes || []).filter(v => v.requestId === x.id && v.approve).length, requiredVotes: Math.ceil(x.voterIds.length / 2) })) : undefined;
  return { ...g, members, available: Math.max(0, g.limit - members.length), cycle: currentCycle(state, groupId), events: state.events.filter(x => x.groupId === groupId), contributions: state.contributions.filter(x => x.groupId === groupId), expenses: state.expenses.filter(x => x.groupId === groupId), settlements: state.settlements.filter(x => x.groupId === groupId), joinRequests };
}
function currentCycle(state, groupId) { return (state.cycles || []).find(x => x.groupId === groupId && x.status === 'active') || null; }
function addCycleParticipant(state, groupId, userId) {
  const cycle = currentCycle(state, groupId);
  if (cycle && !cycle.participants.some(x => x.userId === userId)) cycle.participants.push({ userId, joinedAt: now(), hostedEventId: null, exception: null, departedAt: null });
}

export function updateProfile(state, actorId, input) {
  const user = state.users.find(x => x.id === actorId && !x.deletedAt) || fail('user_not_found', 404);
  const socials = {};
  for (const site of ['instagram', 'facebook', 'snapchat']) {
    const handle = String(input.socials?.[site] || '').trim().replace(/^@/, '');
    if (handle && !/^[a-zA-Z0-9._-]{1,40}$/.test(handle)) fail('invalid_social_handle');
    if (handle) socials[site] = handle;
  }
  const bio = String(input.bio || '').trim();
  if (bio.length > 500) fail('invalid_bio');
  user.profile = { ...(user.profile || {}), bio, socials };
  return user.profile;
}

export function requestJoin(state, actorId, groupId, shareProfile = false) {
  const g = group(state, groupId);
  if (g.visibility !== 'discoverable') fail('invitation_required', 403);
  if (shareProfile !== true) fail('profile_share_consent_required');
  const applicant = state.users.find(x => x.id === actorId && !x.deletedAt) || fail('user_not_found', 404);
  if (applicant.identityStatus !== 'verified') fail('identity_verification_required', 403);
  if (member(state, groupId, actorId)) fail('already_member');
  if (state.memberships.some(m => m.groupId === groupId && blocked(state, actorId, m.userId))) fail('blocked', 403);
  const prior = state.joinRequests.find(x => x.groupId === groupId && x.userId === actorId && ['requested','waitlisted'].includes(x.status));
  if (prior) return prior;
  const rejection = state.joinRequests.filter(x => x.groupId === groupId && x.userId === actorId && x.status === 'declined').sort((a,b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')))[0];
  if (rejection?.reapplyAfter && rejection.reapplyAfter > now()) fail('reapply_cooldown', 403);
  const voterIds = state.memberships.filter(m => m.groupId === groupId && m.status === 'active' && state.users.find(u => u.id === m.userId)?.identityStatus === 'verified').map(m => m.userId);
  if (!voterIds.length) fail('no_verified_voters', 409);
  const item = { id: id(), groupId, userId: actorId, status: activeCount(state, groupId) < g.limit ? 'requested' : 'waitlisted', voterIds, reviewProfile: { name: applicant.name, bio: applicant.profile?.bio || '', socials: { ...applicant.profile?.socials }, photoId: applicant.profile?.photoId || null, whatsappVerified: applicant.profile?.whatsappVerified === true }, createdAt: now() };
  state.joinRequests.push(item); return item;
}

export function voteJoinRequest(state, actorId, requestId, approve) {
  const request = state.joinRequests.find(x => x.id === requestId) || fail('request_not_found', 404);
  const g = group(state, request.groupId);
  requireMember(state, g.id, actorId);
  if (!['requested', 'waitlisted'].includes(request.status)) fail('request_stale', 409);
  if (!request.voterIds?.includes(actorId) || state.users.find(x => x.id === actorId)?.identityStatus !== 'verified') fail('verified_voter_required', 403);
  if (typeof approve !== 'boolean') fail('invalid_vote');
  state.joinVotes ||= [];
  if (state.joinVotes.some(x => x.requestId === requestId && x.voterId === actorId)) fail('already_voted', 409);
  state.joinVotes.push({ requestId, voterId: actorId, approve, createdAt: now() });
  const votes = state.joinVotes.filter(x => x.requestId === requestId);
  const yes = votes.filter(x => x.approve).length;
  if (yes >= Math.ceil(request.voterIds.length / 2)) {
    if (activeCount(state, g.id) >= g.limit) request.status = 'waitlisted';
    else if (state.memberships.some(m => m.groupId === g.id && blocked(state, request.userId, m.userId))) request.status = 'declined';
    else {
      state.memberships.push({ id: id(), groupId: g.id, userId: request.userId, role: 'member', status: 'active', joinedAt: now() });
      addCycleParticipant(state, g.id, request.userId);
      request.status = 'approved';
    }
  } else if (votes.length === request.voterIds.length) request.status = 'declined';
  if (['approved', 'declined'].includes(request.status)) {
    request.reviewProfile = null; request.decidedAt = now();
    if (request.status === 'declined') { const cooldown = new Date(); cooldown.setUTCMonth(cooldown.getUTCMonth() + 3); request.reapplyAfter = cooldown.toISOString(); }
  }
  return { status: request.status, yesVotes: yes, requiredVotes: Math.ceil(request.voterIds.length / 2) };
}

export function overrideRejection(state, actorId, requestId, reason) {
  const request = state.joinRequests.find(x => x.id === requestId) || fail('request_not_found', 404);
  const g = group(state, request.groupId);
  requireHost(state, g.id, actorId);
  if (state.users.find(x => x.id === actorId)?.identityStatus !== 'verified') fail('verified_admin_required', 403);
  if (request.status !== 'declined' || !request.reapplyAfter || request.reapplyAfter <= now()) fail('override_not_applicable', 409);
  if (activeCount(state, g.id) >= g.limit) fail('group_full', 409);
  if (state.memberships.some(m => m.groupId === g.id && blocked(state, request.userId, m.userId))) fail('blocked', 403);
  state.memberships.push({ id: id(), groupId: g.id, userId: request.userId, role: 'member', status: 'active', joinedAt: now() });
  addCycleParticipant(state, g.id, request.userId);
  request.status = 'approved'; request.override = { by: actorId, reason: required(reason, 300), at: now() };
  state.audit.push({ at: now(), actorId, groupId: g.id, action: 'join_rejection_overridden', requestId, reason: request.override.reason });
  return request;
}

export function invite(state, actorId, groupId, targetId, ttlHours = 168) {
  requireHost(state, groupId, actorId); group(state, groupId);
  if (!state.users.some(u => u.id === targetId && !u.deletedAt)) fail('user_not_found', 404);
  if (blocked(state, actorId, targetId)) fail('blocked', 403);
  const invitation = { id: id(), groupId, targetId, invitedBy: actorId, status: 'pending', createdAt: now(), expiresAt: new Date(Date.now() + integer(ttlHours, 1, 720) * 3600000).toISOString() };
  state.invitations.push(invitation); return invitation;
}

export function acceptInvite(state, actorId, invitationId) {
  const inv = state.invitations.find(x => x.id === invitationId && x.targetId === actorId) || fail('invitation_not_found', 404);
  const g = group(state, inv.groupId);
  if (inv.status !== 'pending' || inv.expiresAt <= now()) fail('invitation_expired', 409);
  if (!isHost(state, g.id, inv.invitedBy)) fail('invitation_stale', 409);
  if (state.memberships.some(m => m.groupId === g.id && blocked(state, actorId, m.userId))) fail('blocked', 403);
  if (activeCount(state, g.id) >= g.limit) fail('group_full', 409);
  if (!member(state, g.id, actorId)) state.memberships.push({ id: id(), groupId: g.id, userId: actorId, role: 'member', status: 'active', joinedAt: now() });
  addCycleParticipant(state, g.id, actorId);
  inv.status = 'accepted'; return g;
}

export function decideRequest(state, actorId, requestId, decision) {
  if (!['approve', 'decline'].includes(decision)) fail('invalid_decision');
  return voteJoinRequest(state, actorId, requestId, decision === 'approve');
}

export function leaveGroup(state, actorId, groupId) {
  const m = requireMember(state, groupId, actorId);
  if (m.role === 'host' && state.memberships.filter(x => x.groupId === groupId && x.role === 'host' && x.status === 'active').length === 1) fail('transfer_host_first', 409);
  m.status = 'left'; m.leftAt = now();
  const p=currentCycle(state,groupId)?.participants.find(x=>x.userId===actorId);
  if(p) p.departedAt=now();
  return m;
}

export function rotateHost(state, actorId, groupId, targetId) {
  requireHost(state, groupId, actorId);
  const target = requireMember(state, groupId, targetId);
  member(state, groupId, actorId).role = 'member'; target.role = 'host';
  state.audit.push({ at: now(), actorId, groupId, action: 'host_rotated', targetId }); return target;
}

export function createEvent(state, actorId, groupId, input) {
  requireMember(state, groupId, actorId); group(state, groupId);
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime())) fail('invalid_date');
  const timezone = required(input.timezone || 'Asia/Kolkata', 80);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('invalid_timezone'); }
  const hostId = input.hostId || actorId;
  requireMember(state, groupId, hostId);
  if (hostId !== actorId) requireHost(state, groupId, actorId);
  const cycle = currentCycle(state, groupId);
  const cohostIds = Array.isArray(input.cohostIds) ? distinct(input.cohostIds) : [];
  for (const cohostId of cohostIds) requireMember(state, groupId, cohostId);
  if (cohostIds.includes(hostId)) fail('host_cannot_cohost');
  const event = { id: id(), groupId, cycleId: cycle?.id || null, title: required(input.title, 120), theme: typeof input.theme === 'string' ? input.theme.trim().slice(0, 160) : '', startsAt: startsAt.toISOString(), timezone, location: typeof input.location === 'string' ? input.location.trim().slice(0, 300) : '', reservation: typeof input.reservation === 'string' ? input.reservation.trim().slice(0, 500) : '', scope: input.scope === 'open' ? 'open' : 'group', capacity: integer(input.capacity || group(state, groupId).limit, 1, 100), hostId, cohostIds, status: 'scheduled', version: 1, changes: [], createdBy: actorId, rsvps: {}, createdAt: now() };
  state.events.push(event); return event;
}

export function updateEvent(state, actorId, eventId, input) {
  const event = state.events.find(x => x.id === eventId) || fail('event_not_found', 404);
  requireMember(state, event.groupId, actorId);
  if (event.status !== 'scheduled') fail('event_not_editable', 409);
  if (actorId !== event.hostId && !event.cohostIds.includes(actorId) && !isHost(state, event.groupId, actorId)) fail('event_host_required', 403);
  if (input.version !== event.version) fail('event_stale', 409);
  const changes = {};
  for (const key of ['title','theme','location','reservation']) if (typeof input[key] === 'string') { const value = input[key].trim().slice(0, key === 'reservation' ? 500 : 300); if (key === 'title' && !value) fail('invalid_text'); if (value !== event[key]) { changes[key] = { from: event[key], to: value }; event[key] = value; } }
  if (input.startsAt) { const d = new Date(input.startsAt); if (!Number.isFinite(d.getTime())) fail('invalid_date'); if (d.toISOString() !== event.startsAt) { changes.startsAt = { from: event.startsAt, to: d.toISOString() }; event.startsAt = d.toISOString(); } }
  if (input.timezone) { const tz = required(input.timezone, 80); try { new Intl.DateTimeFormat('en',{timeZone:tz}); } catch { fail('invalid_timezone'); } if (tz !== event.timezone) { changes.timezone = { from: event.timezone, to: tz }; event.timezone = tz; } }
  if (input.scope && ['group','open'].includes(input.scope) && input.scope !== event.scope) { changes.scope = { from:event.scope,to:input.scope }; event.scope=input.scope; }
  if (input.capacity !== undefined) { const capacity=integer(input.capacity,1,100); if (capacity < Object.values(event.rsvps).filter(x=>x==='going').length) fail('capacity_below_rsvps',409); if (capacity!==event.capacity) { changes.capacity={from:event.capacity,to:capacity}; event.capacity=capacity; } }
  if (Object.keys(changes).length) { event.version++; event.changes.push({ version:event.version, changedBy:actorId, at:now(), changes }); }
  return event;
}

export function completeEvent(state, actorId, eventId) {
  const event = state.events.find(x => x.id === eventId) || fail('event_not_found', 404);
  if (actorId !== event.hostId && !isHost(state,event.groupId,actorId)) fail('event_host_required',403);
  if (event.status !== 'scheduled') fail('event_stale',409);
  if (event.startsAt > now()) fail('event_not_started',409);
  event.status='completed'; event.completedAt=now();
  const cycle=(state.cycles||[]).find(x=>x.id===event.cycleId && x.status==='active');
  const participant=cycle?.participants.find(x=>x.userId===event.hostId && !x.departedAt);
  if (participant && !participant.hostedEventId) participant.hostedEventId=event.id;
  return event;
}

export function cancelEvent(state, actorId, eventId, reason) {
  const event=state.events.find(x=>x.id===eventId)||fail('event_not_found',404);
  if (actorId!==event.hostId && !isHost(state,event.groupId,actorId)) fail('event_host_required',403);
  if (event.status!=='scheduled') fail('event_stale',409);
  event.status='cancelled'; event.cancelledAt=now(); event.cancelReason=required(reason,300); event.version++;
  event.changes.push({version:event.version,changedBy:actorId,at:now(),changes:{status:{from:'scheduled',to:'cancelled'}}});
  return event;
}

export function cycleException(state, actorId, groupId, targetId, reason) {
  requireHost(state,groupId,actorId);
  const cycle=currentCycle(state,groupId)||fail('cycle_not_found',404);
  const p=cycle.participants.find(x=>x.userId===targetId && !x.departedAt)||fail('participant_not_found',404);
  if (p.hostedEventId) fail('already_hosted',409);
  p.exception={reason:required(reason,300),approvedBy:actorId,at:now()}; return p;
}

export function completeCycle(state, actorId, groupId) {
  requireHost(state,groupId,actorId);
  const cycle=currentCycle(state,groupId)||fail('cycle_not_found',404);
  const pending=cycle.participants.filter(x=>!x.departedAt && !x.hostedEventId && !x.exception);
  if (pending.length) fail('hosting_incomplete',409);
  cycle.status='completed'; cycle.completedAt=now();
  const participants=state.memberships.filter(x=>x.groupId===groupId && x.status==='active').map(x=>({userId:x.userId,joinedAt:now(),hostedEventId:null,exception:null,departedAt:null}));
  const next={id:id(),groupId,number:cycle.number+1,status:'active',participants,createdAt:now(),completedAt:null};
  state.cycles.push(next); return {completed:cycle,next};
}

export function rsvp(state, actorId, eventId, response) {
  const event = state.events.find(x => x.id === eventId) || fail('event_not_found', 404);
  requireMember(state, event.groupId, actorId);
  if (event.status !== 'scheduled') fail('event_stale', 409);
  if (!['going','maybe','not_going'].includes(response)) fail('invalid_rsvp');
  if (response==='going' && event.rsvps[actorId]!=='going' && Object.values(event.rsvps).filter(x=>x==='going').length>=event.capacity) fail('event_full',409);
  event.rsvps[actorId] = response; return event;
}

export function recordContribution(state, actorId, groupId, input) {
  requireMember(state, groupId, actorId);
  const targetId = input.userId || actorId;
  requireMember(state, groupId, targetId);
  const item = { id: id(), groupId, userId: targetId, amountPaise: integer(input.amountPaise, 1), currency: 'INR', kind: input.kind === 'paid' ? 'paid' : 'due', note: typeof input.note === 'string' ? input.note.trim().slice(0, 300) : '', recordedBy: actorId, createdAt: now() };
  if (targetId !== actorId) requireHost(state, groupId, actorId);
  state.contributions.push(item); return item;
}

export function splitPaise(amountPaise, participantIds) {
  integer(amountPaise, 1); const ids = distinct(participantIds).sort();
  if (!ids.length || ids.length !== participantIds.length) fail('invalid_participants');
  const each = Math.floor(amountPaise / ids.length); let remainder = amountPaise % ids.length;
  return ids.map(userId => ({ userId, amountPaise: each + (remainder-- > 0 ? 1 : 0) }));
}

export function createExpense(state, actorId, groupId, input) {
  requireMember(state, groupId, actorId);
  const g = group(state, groupId);
  const paidBy = input.paidBy || actorId;
  requireMember(state, groupId, paidBy);
  let participantIds;
  if ((g.expenseSplitBasis || 'members') === 'attendees') {
    const event = state.events.find(x => x.id === input.eventId && x.groupId === groupId && x.status !== 'cancelled') || fail('event_required');
    participantIds = Object.entries(event.rsvps).filter(([,response]) => response === 'going').map(([userId]) => userId);
  } else participantIds = state.memberships.filter(x => x.groupId === groupId && x.status === 'active').map(x => x.userId);
  if (!participantIds.length) fail('no_expense_participants');
  for (const userId of participantIds) requireMember(state, groupId, userId);
  const amountPaise = integer(input.amountPaise, 1);
  const splits = splitPaise(amountPaise, participantIds);
  const item = { id: id(), groupId, eventId: input.eventId || null, splitBasis: g.expenseSplitBasis || 'members', title: required(input.title, 120), amountPaise, currency: 'INR', paidBy, splits, approvals: [], status: 'proposed', createdBy: actorId, createdAt: now() };
  state.expenses.push(item); return item;
}

export function approveExpense(state, actorId, expenseId) {
  const item = state.expenses.find(x => x.id === expenseId) || fail('expense_not_found', 404);
  requireMember(state, item.groupId, actorId);
  if (item.status !== 'proposed') fail('expense_stale', 409);
  if (!item.splits.some(x => x.userId === actorId)) fail('not_expense_participant', 403);
  if (item.approvals.includes(actorId)) fail('already_approved', 409);
  item.approvals.push(actorId);
  if (item.splits.every(x => item.approvals.includes(x.userId))) { item.status = 'agreed'; item.agreedAt = now(); }
  return { status: item.status, approvals: item.approvals.length, required: item.splits.length };
}

export function recordSettlement(state, actorId, groupId, input) {
  requireMember(state, groupId, actorId);
  requireMember(state, groupId, input.fromId); requireMember(state, groupId, input.toId);
  if (input.fromId === input.toId) fail('same_party');
  if (actorId !== input.fromId && actorId !== input.toId) fail('party_required', 403);
  const item = { id: id(), groupId, fromId: input.fromId, toId: input.toId, amountPaise: integer(input.amountPaise, 1), currency: 'INR', status: 'recorded', recordedBy: actorId, confirmedBy: null, createdAt: now() };
  state.settlements.push(item); return item;
}

export function confirmSettlement(state, actorId, settlementId) {
  const item = state.settlements.find(x => x.id === settlementId) || fail('settlement_not_found', 404);
  requireMember(state, item.groupId, actorId);
  if (item.status !== 'recorded') fail('settlement_stale', 409);
  if (actorId === item.recordedBy || ![item.fromId,item.toId].includes(actorId)) fail('counterparty_required', 403);
  item.status = 'confirmed'; item.confirmedBy = actorId; item.confirmedAt = now(); return item;
}

export function reportUser(state, actorId, targetId, groupId, reason) {
  requireMember(state, groupId, actorId); requireMember(state, groupId, targetId);
  if (actorId === targetId) fail('same_user');
  const item = { id: id(), groupId, actorId, targetId, reason: required(reason, 1000), status: 'open', createdAt: now() };
  state.reports.push(item); return { id: item.id, status: item.status };
}

export function blockUser(state, actorId, targetId) {
  if (actorId === targetId) fail('same_user');
  if (!state.users.some(x => x.id === targetId)) fail('user_not_found', 404);
  if (!state.blocks.some(x => x.actorId === actorId && x.targetId === targetId)) state.blocks.push({ actorId, targetId, createdAt: now() });
  return { blocked: true };
}

export function setContact(state, actorId, value, consent) {
  const u = state.users.find(x => x.id === actorId && !x.deletedAt) || fail('user_not_found', 404);
  u.contact = value ? required(value, 160) : null; u.contactConsent = consent === true && !!u.contact;
  return { contact: u.contact, contactConsent: u.contactConsent };
}

export function exportOwnData(state, actorId) {
  const memberships = state.memberships.filter(x => x.userId === actorId);
  const groupIds = memberships.map(x => x.groupId);
  return { user: state.users.find(x => x.id === actorId), memberships, joinRequests: state.joinRequests.filter(x => x.userId === actorId), invitations: state.invitations.filter(x => x.targetId === actorId), contributions: state.contributions.filter(x => x.userId === actorId || x.recordedBy === actorId), expenses: state.expenses.filter(x => x.createdBy === actorId || x.paidBy === actorId || x.splits.some(s => s.userId === actorId)), settlements: state.settlements.filter(x => x.fromId === actorId || x.toId === actorId), groupIds };
}

export function deleteOwnAccount(state, actorId) {
  const u = state.users.find(x => x.id === actorId && !x.deletedAt) || fail('user_not_found', 404);
  if (state.memberships.some(x => x.userId === actorId && x.role === 'host' && x.status === 'active' && state.memberships.filter(y => y.groupId === x.groupId && y.role === 'host' && y.status === 'active').length === 1)) fail('transfer_host_first', 409);
  u.name = 'Former member'; u.interests = []; u.contact = null; u.contactConsent = false; u.deletedAt = now();
  state.memberships.filter(x => x.userId === actorId && x.status === 'active').forEach(x => { x.status = 'left'; x.leftAt = now(); });
  state.joinRequests.filter(x => x.userId === actorId && ['requested','waitlisted'].includes(x.status)).forEach(x => { x.status = 'cancelled'; });
  state.invitations.filter(x => x.targetId === actorId && x.status === 'pending').forEach(x => { x.status = 'revoked'; });
  state.blocks = state.blocks.filter(x => x.actorId !== actorId && x.targetId !== actorId);
  return { deleted: true };
}
