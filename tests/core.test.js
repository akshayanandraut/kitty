import test from 'node:test';
import assert from 'node:assert/strict';
import * as k from '../src/core.js';

const person = (s, name) => k.createUser(s,{name,adultAttested:true,selfAttestedWoman:true,syntheticVerified:true});
const circle = (s, host, limit=3) => k.createGroup(s,host.id,{title:'Synthetic Sunday Circle',description:'Synthetic group for tests',city:'Pune',limit,rules:'Be respectful'});
const join = (s,g,u,h) => { const r=k.requestJoin(s,u.id,g.id,true); let result; for (const voterId of r.voterIds) { result=k.voteJoinRequest(s,voterId,r.id,true); if (result.status === 'approved' || result.status === 'waitlisted') break; } return result; };

test('adult and women-only self-attestation are separate prerequisites',()=>{
  const s=k.initialState();
  assert.throws(()=>k.createUser(s,{name:'A',adultAttested:false,selfAttestedWoman:true}),/adult_attestation_required/);
  assert.throws(()=>k.createUser(s,{name:'A',adultAttested:true,selfAttestedWoman:false}),/eligibility_attestation_required/);
});

test('capacity approval, waitlist, stale requests and invitation expiry',()=>{
  const s=k.initialState(), h=person(s,'Host'), a=person(s,'A'), b=person(s,'B'), c=person(s,'C'), g=circle(s,h,2);
  join(s,g,a,h);
  const r=k.requestJoin(s,b.id,g.id,true);
  assert.equal(r.status,'waitlisted');
  assert.equal(k.decideRequest(s,h.id,r.id,'approve').status,'waitlisted');
  assert.throws(()=>k.decideRequest(s,c.id,r.id,'approve'),/not_group_member/);
  const i=k.invite(s,h.id,g.id,c.id); i.expiresAt='2000-01-01T00:00:00.000Z';
  assert.throws(()=>k.acceptInvite(s,c.id,i.id),/invitation_expired/);
  assert.equal(k.discovery(s,b.id)[0].available,0);
});

test('cross-group data is inaccessible and public discovery omits private details',()=>{
  const s=k.initialState(), h=person(s,'Host'), stranger=person(s,'Stranger'), g=circle(s,h);
  k.setContact(s,h.id,'synthetic@example.invalid',true);
  k.createEvent(s,h.id,g.id,{title:'Test meet',startsAt:'2026-10-01T10:00:00Z',location:'Private synthetic address'});
  assert.throws(()=>k.groupView(s,stranger.id,g.id),/not_group_member/);
  const publicGroup=k.discovery(s,stranger.id)[0];
  assert.equal('events' in publicGroup,false); assert.equal('memberDetails' in publicGroup,false);
  assert.ok(!JSON.stringify(publicGroup).includes('Private synthetic address'));
  assert.ok(!JSON.stringify(publicGroup).includes('synthetic@example.invalid'));
});

test('open session preview is opt-in and omits venue, reservation and member identities',()=>{
  const s=k.initialState(), h=person(s,'Host'), stranger=person(s,'Stranger'), g=circle(s,h);
  k.createEvent(s,h.id,g.id,{title:'Synthetic open tea',startsAt:'2030-10-01T10:00:00Z',scope:'open',theme:'Books',location:'Private address',reservation:'Secret booking'});
  const preview=k.suggestOpenSession(s,stranger.id,()=>0);
  assert.equal(preview.title,'Synthetic open tea');
  assert.equal(preview.city,'Pune');
  assert.ok(!JSON.stringify(preview).includes('Private address'));
  assert.ok(!JSON.stringify(preview).includes('Secret booking'));
  assert.ok(!JSON.stringify(preview).includes(h.name));
  assert.throws(()=>k.groupView(s,stranger.id,g.id),/not_group_member/);
});

test('integer-paise splits are deterministic and total exactly',()=>{
  assert.deepEqual(k.splitPaise(100,['b','a','c']),[{userId:'a',amountPaise:34},{userId:'b',amountPaise:33},{userId:'c',amountPaise:33}]);
  assert.throws(()=>k.splitPaise(100,['a','a']),/invalid_participants/);
});

test('settlement requires counterparty confirmation; no third-party confirmation',()=>{
  const s=k.initialState(), h=person(s,'Host'), a=person(s,'A'), b=person(s,'B'), g=circle(s,h);
  join(s,g,a,h); join(s,g,b,h);
  const x=k.recordSettlement(s,a.id,g.id,{fromId:a.id,toId:b.id,amountPaise:101});
  assert.throws(()=>k.confirmSettlement(s,a.id,x.id),/counterparty_required/);
  assert.throws(()=>k.confirmSettlement(s,h.id,x.id),/counterparty_required/);
  assert.equal(k.confirmSettlement(s,b.id,x.id).status,'confirmed');
});

test('hosting cycle counts only completed hosted events and closes with explicit exception',()=>{
  const s=k.initialState(), h=person(s,'Host'), a=person(s,'A'), g=circle(s,h,2);
  join(s,g,a,h);
  const e1=k.createEvent(s,h.id,g.id,{title:'First',startsAt:'2020-01-01T00:00:00Z'});
  k.cancelEvent(s,h.id,e1.id,'Rescheduled');
  assert.throws(()=>k.completeCycle(s,h.id,g.id),/hosting_incomplete/);
  const e2=k.createEvent(s,h.id,g.id,{title:'Replacement',startsAt:'2020-01-01T00:00:00Z'});
  k.completeEvent(s,h.id,e2.id);
  assert.throws(()=>k.completeCycle(s,h.id,g.id),/hosting_incomplete/);
  k.cycleException(s,h.id,g.id,a.id,'Unable to host this cycle');
  const {completed,next}=k.completeCycle(s,h.id,g.id);
  assert.equal(completed.participants.find(p=>p.userId===a.id).hostedEventId,null);
  assert.equal(next.number,2);
  assert.equal(next.participants.length,2);
});

test('event update checks version, host role, timezone and capacity',()=>{
  const s=k.initialState(), h=person(s,'Host'), a=person(s,'A'), b=person(s,'B'), g=circle(s,h);
  join(s,g,a,h); join(s,g,b,h);
  const e=k.createEvent(s,h.id,g.id,{title:'Plan',startsAt:'2026-10-01T10:00:00Z',hostId:a.id,capacity:2});
  k.rsvp(s,h.id,e.id,'going'); k.rsvp(s,a.id,e.id,'going');
  assert.throws(()=>k.rsvp(s,b.id,e.id,'going'),/event_full/);
  assert.throws(()=>k.updateEvent(s,b.id,e.id,{version:1,title:'Hijack'}),/event_host_required/);
  assert.throws(()=>k.updateEvent(s,a.id,e.id,{version:1,capacity:1}),/capacity_below_rsvps/);
  assert.equal(k.updateEvent(s,a.id,e.id,{version:1,theme:'Tea and books',timezone:'Asia/Kolkata'}).version,2);
  assert.throws(()=>k.updateEvent(s,a.id,e.id,{version:1,title:'Stale'}),/event_stale/);
});

test('deleting sole host fails and export contains own scope',()=>{
  const s=k.initialState(), h=person(s,'Host'), a=person(s,'A'), g=circle(s,h,2);
  join(s,g,a,h);
  assert.throws(()=>k.deleteOwnAccount(s,h.id),/transfer_host_first/);
  const out=k.exportOwnData(s,a.id);
  assert.equal(out.user.id,a.id);
  assert.ok(!JSON.stringify(out).includes('synthetic@example.invalid'));
  k.deleteOwnAccount(s,a.id);
  assert.throws(()=>k.groupView(s,a.id,g.id),/not_group_member/);
});

test('join vote uses a fixed verified electorate and protects profile until application',()=>{
  const s=k.initialState(), host=person(s,'Host'), peer=person(s,'Peer'), applicant=person(s,'Applicant'), outsider=person(s,'Outsider'), g=circle(s,host,4);
  join(s,g,peer,host);
  k.updateProfile(s,applicant.id,{bio:'Books and brunch',socials:{instagram:'kitty_reader'}});
  assert.ok(!JSON.stringify(k.discovery(s,outsider.id)).includes('kitty_reader'));
  assert.throws(()=>k.requestJoin(s,applicant.id,g.id),/profile_share_consent_required/);
  const request=k.requestJoin(s,applicant.id,g.id,true);
  assert.equal(request.voterIds.length,2);
  assert.equal(k.groupView(s,host.id,g.id).joinRequests[0].reviewProfile.socials.instagram,'kitty_reader');
  assert.throws(()=>k.groupView(s,outsider.id,g.id),/not_group_member/);
  assert.throws(()=>k.voteJoinRequest(s,outsider.id,request.id,true),/not_group_member/);
  const result=k.voteJoinRequest(s,peer.id,request.id,true);
  assert.equal(result.requiredVotes,1);
  assert.equal(result.status,'approved');
  assert.equal(request.reviewProfile,null);
  assert.throws(()=>k.voteJoinRequest(s,host.id,request.id,true),/request_stale/);
});

test('four verified voters require two approvals; unverified member cannot vote',()=>{
  const s=k.initialState(), host=person(s,'Host'), a=person(s,'A'), b=person(s,'B'), c=person(s,'C'), applicant=person(s,'Applicant'), g=circle(s,host,6);
  join(s,g,a,host); join(s,g,b,host); join(s,g,c,host);
  const r=k.requestJoin(s,applicant.id,g.id,true);
  assert.equal(r.voterIds.length,4);
  assert.equal(k.voteJoinRequest(s,a.id,r.id,true).status,'requested');
  assert.throws(()=>k.voteJoinRequest(s,a.id,r.id,true),/already_voted/);
  b.identityStatus='expired';
  assert.throws(()=>k.voteJoinRequest(s,b.id,r.id,true),/verified_voter_required/);
  assert.equal(k.voteJoinRequest(s,c.id,r.id,true).status,'approved');
});

test('rejection cooldown belongs to one group and a verified admin can override with a reason',()=>{
  const s=k.initialState(), host=person(s,'Host'), secondHost=person(s,'Second host'), applicant=person(s,'Applicant');
  const first=circle(s,host,3), second=circle(s,secondHost,3);
  const request=k.requestJoin(s,applicant.id,first.id,true);
  assert.equal(k.voteJoinRequest(s,host.id,request.id,false).status,'declined');
  assert.throws(()=>k.requestJoin(s,applicant.id,first.id,true),/reapply_cooldown/);
  assert.equal(k.requestJoin(s,applicant.id,second.id,true).status,'requested');
  assert.throws(()=>k.overrideRejection(s,secondHost.id,request.id,'Group welcomes her'),/host_required/);
  assert.equal(k.overrideRejection(s,host.id,request.id,'We discussed the initial concern').status,'approved');
  assert.ok(s.audit.some(x=>x.action==='join_rejection_overridden'));
});

test('group cost is visible and extras require each included member to agree',()=>{
  const s=k.initialState(), host=person(s,'Host'), peer=person(s,'Peer');
  const g=k.createGroup(s,host.id,{title:'Sample',description:'Sample',city:'Pune',limit:3,avgMonthlyCostPaise:150000,expenseSplitBasis:'members'});
  join(s,g,peer,host);
  assert.equal(k.discovery(s,peer.id)[0].avgMonthlyCostPaise,150000);
  const expense=k.createExpense(s,host.id,g.id,{title:'Room booking',amountPaise:10001,paidBy:host.id});
  assert.equal(expense.status,'proposed');
  assert.deepEqual(expense.splits.map(x=>x.amountPaise),[5001,5000]);
  assert.equal(k.approveExpense(s,host.id,expense.id).status,'proposed');
  assert.equal(k.approveExpense(s,peer.id,expense.id).status,'agreed');
});

test('attendee splits include only accepted RSVPs from the chosen meetup',()=>{
  const s=k.initialState(), host=person(s,'Host'), peer=person(s,'Peer');
  const g=k.createGroup(s,host.id,{title:'Sample',description:'Sample',city:'Pune',limit:3,avgMonthlyCostPaise:0,expenseSplitBasis:'attendees'});
  join(s,g,peer,host);
  const event=k.createEvent(s,host.id,g.id,{title:'Tea',startsAt:'2030-01-01T10:00:00Z'});
  k.rsvp(s,peer.id,event.id,'going');
  const expense=k.createExpense(s,host.id,g.id,{title:'Tea',amountPaise:1500,eventId:event.id});
  assert.deepEqual(expense.splits.map(x=>x.userId),[peer.id]);
  assert.throws(()=>k.approveExpense(s,host.id,expense.id),/not_expense_participant/);
});
