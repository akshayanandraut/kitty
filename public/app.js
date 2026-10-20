const content = document.querySelector('#content');
const account = document.querySelector('#account');
const modal = document.querySelector('#modal');
const modalForm = document.querySelector('#modal-form');
const toast = document.querySelector('#toast');
let users = [], current = null, me = null, page = 'home', selectedGroup = null, groupTab = 'members', hostedBishiEnabled = false, hostedSsoEnabled = false, hostedMember = null;

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rupees = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format((paise || 0)/100);
const date = iso => new Date(iso).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
const pill = (text, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;
function notice(message, bad=false){toast.textContent=message;toast.style.background=bad?'#9e3143':'#3c3335';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3500)}
async function api(path, payload){
  const response = await fetch('/api'+path,{method:payload===undefined?'GET':'POST',headers:{'content-type':'application/json',...(current?{'x-demo-user':current}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
  const result=await response.json(); if(!response.ok) throw new Error(result.error||'request_failed'); return result;
}
async function run(fn){try{await fn()}catch(e){notice(e.message.replaceAll('_',' '),true)}}
function openModal(title, fields, onSave, button='Save'){
  document.querySelector('#modal-content').innerHTML=`<h2>${esc(title)}</h2><div class="form-grid">${fields}</div>`;
  document.querySelector('#submit').textContent=button;
  modalForm.onsubmit=e=>{e.preventDefault();run(async()=>{const form=new FormData(modalForm);await onSave(Object.fromEntries(form));modal.close();await render()})};
  modal.showModal();
}
document.querySelector('#cancel').onclick=()=>modal.close();
const field=(label,name,type='text',extra='')=>`<label>${esc(label)}<input name="${esc(name)}" type="${type}" ${extra} required></label>`;
const textArea=(label,name,extra='')=>`<label>${esc(label)}<textarea name="${esc(name)}" ${extra} required></textarea></label>`;
function header(kicker,title,lead,action=''){return `<p class="eyebrow">${kicker}</p><div class="group-head"><div><h1 class="page-title">${title}</h1><p class="lead">${lead}</p></div>${action}</div>`}
function empty(title,detail,action=''){return `<div class="empty"><strong>${title}</strong>${detail}${action}</div>`}
async function refreshUsers(){users=(await api('/demo-users')).users;account.innerHTML=users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')+`<option value="__new">+ New demo person</option>`;if(!current||!users.some(u=>u.id===current))current=users[0]?.id||null;account.value=current||'__new'}
account.onchange=()=>{if(account.value==='__new')return newPerson();current=account.value;selectedGroup=null;render()};
function newPerson(){openModal('New synthetic person',`${field('Name','name','text','maxlength="80"')}<label class="check"><input type="checkbox" name="adultAttested" required> I am at least 18 years old</label><label class="check"><input type="checkbox" name="selfAttestedWoman" required> I self-attest that I am eligible for this women-only community</label><label class="check"><input type="checkbox" name="syntheticVerified"> Mark as synthetically verified for local voting tests</label><p class="small muted">This is a local test identity. It is not real identity or phone verification.</p>`,async f=>{const {user}=await api('/demo-users',{name:f.name,adultAttested:f.adultAttested==='on',selfAttestedWoman:f.selfAttestedWoman==='on',syntheticVerified:f.syntheticVerified==='on'});await refreshUsers();current=user.id;account.value=current;notice('Synthetic account created')},'Create account')}
async function render(){
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(!current){content.innerHTML=header('Welcome','Good company, well planned','Create a synthetic profile to explore the local Kitty flows.')+`<button class="primary" id="start">Create demo person</button>`;document.querySelector('#start').onclick=newPerson;return}
  me=(await api('/me')).user;
  if(selectedGroup) return renderGroup();
  if(page==='home') return renderHome();
  if(page==='discover') return renderDiscover();
  if(page==='groups') return renderGroups();
  if(page==='invitations') return renderInvitations();
  if(page==='account'){await renderAccount();return renderAccountProfile()}
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{page=b.dataset.page;selectedGroup=null;render()});
function createGroup(){openModal('Start a circle',`${field('Circle name','title','text','maxlength="80"')}${textArea('What brings this circle together?','description','maxlength="500"')}${field('City or area (public summary)','city','text','maxlength="80"')}<label>Member limit<input name="limit" type="number" min="2" max="100" value="8" required></label><label>Typical monthly cost in rupees<input name="monthlyCost" type="number" min="0" step="0.01" value="0" required></label><label>How extras are split<select name="expenseSplitBasis"><option value="members">All active members</option><option value="attendees">Event attendees who RSVP going</option></select></label><label>Discoverability<select name="visibility"><option value="discoverable">Discoverable</option><option value="private">Private, invitation only</option></select></label><label>Group rules<textarea name="rules" maxlength="2000"></textarea></label>`,async f=>{const {result}=await api('/groups',{...f,limit:Number(f.limit),avgMonthlyCostPaise:Math.round(Number(f.monthlyCost)*100)});page='groups';selectedGroup=result.id;notice('Circle created')},'Create circle')}
async function renderHome(){const memberships=(await api('/me')).memberships;const invitations=(await api('/invitations')).invitations;const groups=(await api('/discovery')).groups;content.innerHTML=header('Welcome back',`Hello, ${esc(me.name.split(' ')[0])}.`,'Your circles, plans, and shared records in one calm place.')+`<div class="stat-grid"><div class="stat"><b>${memberships.length}</b><span>My circles</span></div><div class="stat"><b>${invitations.length}</b><span>Open invitations</span></div><div class="stat"><b>${groups.filter(g=>g.available>0).length}</b><span>Circles with space</span></div></div><div class="welcome"><div><h2>Make room for meaningful meetups.</h2><p>Start with your existing group or explore circles that have room for another member.</p></div><button class="secondary" id="new-group">Start a circle</button></div><div class="section-head"><h2>Your circles</h2><button class="text-btn" id="all-groups">View all</button></div>${memberships.length?`<div class="grid">${memberships.slice(0,3).map(m=>`<article class="card"><span class="pill">${esc(m.role)}</span><h3>${esc(m.group)}</h3><button class="text-btn" data-group="${m.groupId}">Open circle →</button></article>`).join('')}</div>`:empty('No circles yet','Start one for your existing group or discover a circle with an open place.')}`;bindGroupLinks();document.querySelector('#new-group').onclick=createGroup;document.querySelector('#all-groups').onclick=()=>{page='groups';render()}}
async function renderDiscover(){
  const groups=(await api('/discovery')).groups;
  const sessions=(await api('/open-sessions')).sessions;
  content.innerHTML=header('Meet your people','Discover circles','Browse public summaries. Names, contact details, private venues, and money records stay within each circle.',`<button class="primary" id="new-group">Start a circle</button>`)+
    `<div class="section-head"><h2>Open meetups</h2><button class="secondary" id="surprise">Suggest one for me</button></div><p class="small muted">Suggestions are optional. You can preview and decline before requesting to join.</p><div id="suggestion"></div>`+
    (sessions.length?`<div class="grid">${sessions.map(s=>`<article class="card">${pill(s.city)}<h3>${esc(s.title)}</h3><p>${esc(s.theme||'An open meetup')}</p><div class="meta">${date(s.startsAt)} · ${esc(s.groupTitle)} · ${s.available} places</div><button class="text-btn" data-join="${s.groupId}">Request to join →</button></article>`).join('')}</div>`:empty('No open meetups yet','Hosts can open a session to new members.'))+
    `<div class="section-head"><h2>Discoverable circles</h2></div><div class="grid">${groups.map(g=>`<article class="card"><div class="row">${pill(g.city)}${pill(g.available?`${g.available} places`:'Waitlist',g.available?'green':'amber')}</div><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><div class="meta">${g.members} of ${g.limit} members · Typical ${rupees(g.avgMonthlyCostPaise)} / month · Extras split among ${esc(g.expenseSplitBasis)}</div><button class="text-btn" data-join="${g.id}">Request to join →</button></article>`).join('')}</div>${groups.length?'':empty('No discoverable circles yet','A private circle can still invite members directly.')}`;
  document.querySelector('#new-group').onclick=createGroup;
  const bindJoin=()=>document.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>{if(!confirm('Apply to this circle? Your name, profile bio, social handles, and photo will be visible to its verified members for a membership vote.'))return;run(async()=>{const {result}=await api('/join',{groupId:b.dataset.join,shareProfile:true});notice(result.status==='waitlisted'?'Added to the waitlist':'Request sent for a group vote');render()})});
  bindJoin();
  document.querySelector('#surprise').onclick=()=>run(async()=>{
    const {suggestion}=await api('/suggest-session',{});
    const target=document.querySelector('#suggestion');
    target.innerHTML=suggestion?`<div class="card"><p class="eyebrow">Your optional suggestion</p><h3>${esc(suggestion.title)}</h3><p>${esc(suggestion.theme||'An open meetup')}</p><p class="meta">${date(suggestion.startsAt)} · ${esc(suggestion.city)} · ${esc(suggestion.groupTitle)}</p><div class="actions"><button class="secondary" id="decline-suggestion">Decline</button><button class="primary" data-join="${suggestion.groupId}">Request to join</button></div></div>`:empty('No available suggestions','Try browsing the circles below.');
    document.querySelector('#decline-suggestion')?.addEventListener('click',()=>{target.innerHTML='';notice('Suggestion dismissed')});
    bindJoin();
  });
}
async function renderGroups(){const memberships=(await api('/me')).memberships;content.innerHTML=header('My circles','Where you belong','Each circle has its own people, plans, and private financial records.',`<button class="primary" id="new-group">Start a circle</button>`)+`<div class="grid">${memberships.map(m=>`<article class="card">${pill(m.role)}<h3>${esc(m.group)}</h3><button class="text-btn" data-group="${m.groupId}">Open circle →</button></article>`).join('')}</div>${memberships.length?'':empty('Your list is open','Create a circle or ask to join an existing one.')}`;document.querySelector('#new-group').onclick=createGroup;bindGroupLinks()}
async function renderInvitations(){const invitations=(await api('/invitations')).invitations;content.innerHTML=header('Invitations','A place is waiting','Invitations expire and acceptance still checks the group’s available capacity.')+(invitations.length?`<div class="list">${invitations.map(i=>`<div class="list-item"><div><strong>${esc(i.groupTitle)}</strong><small>Expires ${date(i.expiresAt)}</small></div><button class="primary" data-accept="${i.id}">Accept invitation</button></div>`).join('')}</div>`:empty('Nothing waiting right now','When a host invites you, it will appear here.'));document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>run(async()=>{await api('/invite/accept',{invitationId:b.dataset.accept});notice('You joined the circle');render()}))}
function bindGroupLinks(){document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{selectedGroup=b.dataset.group;groupTab='members';render()})}
async function renderGroup() {
  let g;
  try { g = (await api('/groups/' + selectedGroup)).group; }
  catch (error) { selectedGroup = null; notice(error.message, true); return render(); }
  const host = g.members.some(m => m.userId === current && m.role === 'host');
  const memberName = id => g.members.find(m => m.userId === id)?.name || users.find(u => u.id === id)?.name || 'Former member';
  const tabs = ['members', 'events', 'contributions', 'expenses', 'settlements'];
  content.innerHTML = `<button class="text-btn" id="back">← My circles</button>` +
    header(esc(g.city), esc(g.title), esc(g.description), pill(`${g.members.length}/${g.limit} members`)) +
    `<div class="note">${esc(g.rules || 'This circle has not added rules yet.')} · Typical monthly cost: ${rupees(g.avgMonthlyCostPaise)} · Extras split among ${esc(g.expenseSplitBasis || 'members')} · Private details are shown only to members.</div>
    <div class="tabs">${tabs.map(t => `<button class="tab ${groupTab === t ? 'active' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div id="tab-body"></div>`;
  document.querySelector('#back').onclick = () => { selectedGroup = null; page = 'groups'; render(); };
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { groupTab = b.dataset.tab; render(); });
  const body = document.querySelector('#tab-body');

  if (groupTab === 'members') {
    body.innerHTML = `<div class="section-head"><h2>Members</h2>${host ? '<button class="secondary" id="invite">Invite a person</button>' : ''}</div>
      <div class="list">${g.members.map(m => `<div class="list-item"><div><strong>${esc(m.name)}</strong><small>${esc(m.role)}${m.contact ? ' · ' + esc(m.contact) : ''}</small></div>${host && m.userId !== current ? `<button class="text-btn" data-host="${m.userId}">Make host</button>` : ''}</div>`).join('')}</div>
      ${g.joinRequests ? `<div class="section-head"><h2>Group votes</h2></div>${g.joinRequests.length ? `<div class="list">${g.joinRequests.map(r => `<div class="list-item"><div><strong>${esc(r.reviewProfile?.name || 'Applicant')}</strong><small>${esc(r.status)} · ${r.yesVotes}/${r.requiredVotes} approvals needed · ${r.votes}/${r.voterIds.length} votes cast</small><p class="small">${esc(r.reviewProfile?.bio || 'No bio shared')}</p><small>${Object.entries(r.reviewProfile?.socials || {}).map(([site,handle])=>esc(site)+': @'+esc(handle)).join(' · ')} ${r.reviewProfile?.whatsappVerified ? ' · WhatsApp verified' : ' · WhatsApp unverified'}</small></div><div class="actions"><button class="secondary" data-decide="${r.id}:decline">Vote no</button><button class="primary" data-decide="${r.id}:approve">Vote yes</button></div></div>`).join('')}</div>` : empty('No votes awaiting you', 'Applicants are reviewed only by verified group members.')}` : ''}`;
    document.querySelector('#invite')?.addEventListener('click', () => openModal('Invite a person', `<label>Person<select name="targetId">${users.filter(u => !g.members.some(m => m.userId === u.id)).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>`, async f => { await api('/invite', { groupId: g.id, targetId: f.targetId }); notice('Invitation created'); }, 'Invite'));
    document.querySelectorAll('[data-decide]').forEach(b => b.onclick = () => run(async () => { const [requestId, decision] = b.dataset.decide.split(':'); const result = (await api('/request/decide', { requestId, decision })).result; notice(result.status === 'waitlisted' ? 'Still waitlisted; group is full' : 'Request updated'); render(); }));
    document.querySelectorAll('[data-host]').forEach(b => b.onclick = () => run(async () => { await api('/group/rotate-host', { groupId: g.id, targetId: b.dataset.host }); notice('Host role transferred'); render(); }));
  }

  if (groupTab === 'events') {
    const pending = g.cycle?.participants.filter(p => !p.departedAt && !p.hostedEventId && !p.exception) || [];
    body.innerHTML = `<div class="card"><div class="row"><div><p class="eyebrow">Hosting rotation</p><h3>Cycle ${g.cycle?.number || 1}</h3></div>${pill(`${pending.length} to host`, pending.length ? 'amber' : 'green')}</div><p>Each member hosts a completed meetup once per cycle. Exceptions are recorded separately.</p>
      <div class="list">${(g.cycle?.participants || []).filter(p => !p.departedAt).map(p => `<div class="list-item"><div><strong>${esc(memberName(p.userId))}</strong><small>${p.hostedEventId ? 'Hosted a completed meetup' : p.exception ? 'Exception: ' + esc(p.exception.reason) : 'Eligible to host next'}</small></div>${host && !p.hostedEventId && !p.exception ? `<button class="text-btn" data-exception="${p.userId}">Add exception</button>` : ''}</div>`).join('')}</div>${host && !pending.length ? '<button class="secondary" id="close-cycle">Complete cycle & start next</button>' : ''}</div>
      <div class="section-head"><h2>Meetups</h2><button class="secondary" id="add-event">Schedule meetup</button></div>
      ${g.events.length ? `<div class="list">${g.events.map(e => `<div class="list-item"><div><strong>${esc(e.title)}</strong><small>${date(e.startsAt)} · ${esc(e.timezone)} · ${esc(e.status)} · Host: ${esc(memberName(e.hostId))}</small><small>${esc(e.theme)}${e.location ? ' · ' + esc(e.location) : ''}${e.reservation ? ' · Reservation: ' + esc(e.reservation) : ''}</small>${e.changes?.length ? `<small>${e.changes.length} change notice(s)</small>` : ''}</div><div class="actions"><select aria-label="RSVP for ${esc(e.title)}" data-rsvp="${e.id}" ${e.status !== 'scheduled' ? 'disabled' : ''}><option value="">RSVP</option>${['going', 'maybe', 'not_going'].map(x => `<option value="${x}" ${e.rsvps[current] === x ? 'selected' : ''}>${x.replace('_', ' ')}</option>`).join('')}</select>${e.status === 'scheduled' && (host || e.hostId === current) ? `<button class="secondary" data-edit="${e.id}">Edit</button><button class="secondary" data-held="${e.id}">Mark held</button><button class="text-btn" data-cancel="${e.id}">Cancel</button>` : ''}</div></div>`).join('')}</div>` : empty('No meetups scheduled', 'Add a date and venue visible only to members.')}`;
    document.querySelector('#add-event').onclick = () => openModal('Schedule a meetup', `${field('Title', 'title')}${field('Theme', 'theme')}${field('Starts at', 'startsAt', 'datetime-local')}${field('Timezone', 'timezone', 'text', 'value="Asia/Kolkata"')}<label>Event host<select name="hostId">${g.members.map(m => `<option value="${m.userId}" ${m.userId === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><label>Audience<select name="scope"><option value="group">Group members only</option><option value="open">Open after group approval</option></select></label>${field('Venue (members only)', 'location')}${field('Reservation details (members only)', 'reservation')}<label>Capacity<input name="capacity" type="number" min="1" max="100" value="${g.limit}" required></label>`, async f => { await api('/events', { groupId: g.id, ...f, capacity: Number(f.capacity) }); notice('Meetup scheduled'); });
    document.querySelectorAll('[data-rsvp]').forEach(b => b.onchange = () => run(async () => { await api('/rsvp', { eventId: b.dataset.rsvp, response: b.value }); notice('RSVP updated'); }));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const e = g.events.find(x => x.id === b.dataset.edit); openModal('Update meetup', `${field('Title', 'title', 'text', `value="${esc(e.title)}"`)}${field('Theme', 'theme', 'text', `value="${esc(e.theme)}"`)}${field('Starts at', 'startsAt', 'datetime-local', `value="${esc(e.startsAt.slice(0, 16))}"`)}${field('Timezone', 'timezone', 'text', `value="${esc(e.timezone)}"`)}${field('Venue', 'location', 'text', `value="${esc(e.location)}"`)}${field('Reservation details', 'reservation', 'text', `value="${esc(e.reservation)}"`)}<label>Capacity<input name="capacity" type="number" min="1" max="100" value="${e.capacity}" required></label>`, async f => { await api('/events/update', { eventId: e.id, version: e.version, ...f, capacity: Number(f.capacity) }); notice('Meetup updated; change notice saved'); }); });
    document.querySelectorAll('[data-held]').forEach(b => b.onclick = () => run(async () => { await api('/events/complete', { eventId: b.dataset.held }); notice('Completed hosting recorded'); render(); }));
    document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => openModal('Cancel meetup', field('Reason', 'reason'), async f => { await api('/events/cancel', { eventId: b.dataset.cancel, reason: f.reason }); notice('Cancellation recorded'); }));
    document.querySelectorAll('[data-exception]').forEach(b => b.onclick = () => openModal('Approve hosting exception', field('Reason', 'reason'), async f => { await api('/cycle/exception', { groupId: g.id, targetId: b.dataset.exception, reason: f.reason }); notice('Exception recorded; it does not count as hosting'); }));
    document.querySelector('#close-cycle')?.addEventListener('click', () => run(async () => { await api('/cycle/complete', { groupId: g.id }); notice('Cycle completed; next cycle started'); render(); }));
  }

  if (groupTab === 'contributions') {
    body.innerHTML = `<div class="section-head"><h2>Contribution ledger</h2><button class="secondary" id="add-contribution">Record entry</button></div><div class="note">Members set their own schedule. Kitty records obligations and payments; it does not hold or move money.</div>${g.contributions.length ? `<div class="list">${g.contributions.map(c => `<div class="list-item"><div><strong>${esc(memberName(c.userId))}</strong><small>${date(c.createdAt)} · ${esc(c.note)}</small></div><div>${pill(c.kind, c.kind === 'paid' ? 'green' : 'amber')} <strong>${rupees(c.amountPaise)}</strong></div></div>`).join('')}</div>` : empty('No entries yet', 'Record a due amount or a payment someone has made.')}`;
    document.querySelector('#add-contribution').onclick = () => openModal('Record contribution', `<label>Member<select name="userId">${g.members.map(m => `<option value="${m.userId}" ${m.userId === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><label>Entry type<select name="kind"><option value="due">Due</option><option value="paid">Paid</option></select></label>${field('Amount in rupees', 'rupees', 'number', 'min="0.01" step="0.01"')}${field('Note', 'note')}`, async f => { await api('/contributions', { groupId: g.id, userId: f.userId, kind: f.kind, amountPaise: Math.round(Number(f.rupees) * 100), note: f.note }); notice('Ledger entry recorded'); });
  }

  if (groupTab === 'expenses') {
    body.innerHTML = `<div class="section-head"><h2>Shared expenses</h2><button class="secondary" id="add-expense">Propose expense</button></div><div class="note">This circle splits extras among ${esc(g.expenseSplitBasis || 'members')}. Every included person confirms their share before the expense is agreed.</div>${g.expenses.length ? `<div class="list">${g.expenses.map(e => `<div class="list-item"><div><strong>${esc(e.title)}</strong><small>Paid by ${esc(memberName(e.paidBy))} · ${e.splits.length} shares · ${esc(e.status || 'proposed')} · ${e.approvals?.length || 0} confirmed</small></div><div class="actions"><strong>${rupees(e.amountPaise)}</strong>${e.status === 'proposed' && e.splits.some(s=>s.userId===current) && !e.approvals?.includes(current) ? `<button class="primary" data-approve-expense="${e.id}">Confirm my share</button>` : ''}</div></div>`).join('')}</div>` : empty('Nothing to split yet', 'Propose an extra cost for this circle.')}`;
    document.querySelector('#add-expense').onclick = () => openModal('Propose shared expense', `${field('What was paid for?', 'title')}${field('Amount in rupees', 'rupees', 'number', 'min="0.01" step="0.01"')}<label>Paid by<select name="paidBy">${g.members.map(m => `<option value="${m.userId}">${esc(m.name)}</option>`).join('')}</select></label>${g.expenseSplitBasis === 'attendees' ? `<label>Meetup<select name="eventId">${g.events.filter(e=>e.status!=='cancelled').map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select></label>` : ''}<p class="small muted">Shares follow the group rule; every included person confirms before this becomes an agreed expense.</p>`, async f => { await api('/expenses', { groupId: g.id, title: f.title, amountPaise: Math.round(Number(f.rupees) * 100), paidBy: f.paidBy, eventId: f.eventId }); notice('Expense proposed for confirmation'); });
    document.querySelectorAll('[data-approve-expense]').forEach(b=>b.onclick=()=>run(async()=>{await api('/expenses/approve',{expenseId:b.dataset.approveExpense});notice('Your share confirmed');render()}));
  }

  if (groupTab === 'settlements') {
    body.innerHTML = `<div class="section-head"><h2>Settlements</h2><button class="secondary" id="add-settlement">Record settlement</button></div><div class="note">A recorded settlement needs the other party's confirmation. It is not proof of bank transfer.</div>${g.settlements.length ? `<div class="list">${g.settlements.map(s => `<div class="list-item"><div><strong>${esc(memberName(s.fromId))} → ${esc(memberName(s.toId))}</strong><small>${date(s.createdAt)} · ${esc(s.status)}</small></div><div class="actions"><strong>${rupees(s.amountPaise)}</strong>${s.status === 'recorded' && s.recordedBy !== current && [s.fromId, s.toId].includes(current) ? `<button class="primary" data-confirm="${s.id}">Confirm</button>` : ''}</div></div>`).join('')}</div>` : empty('No settlements recorded', 'Keep a shared record when members settle outside Kitty.')}`;
    document.querySelector('#add-settlement').onclick = () => openModal('Record settlement', `<label>From<select name="fromId">${g.members.map(m => `<option value="${m.userId}">${esc(m.name)}</option>`).join('')}</select></label><label>To<select name="toId">${g.members.map(m => `<option value="${m.userId}">${esc(m.name)}</option>`).join('')}</select></label>${field('Amount in rupees', 'rupees', 'number', 'min="0.01" step="0.01"')}`, async f => { await api('/settlements', { groupId: g.id, fromId: f.fromId, toId: f.toId, amountPaise: Math.round(Number(f.rupees) * 100) }); notice('Settlement recorded; awaiting confirmation'); });
    document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => run(async () => { await api('/settlements/confirm', { settlementId: b.dataset.confirm }); notice('Settlement confirmed'); render(); }));
  }
}

async function renderAccount(){const status=await api('/status');content.innerHTML=header('Account & trust','Your Kitty account','Your eligibility statement and controls for sharing your details.')+`<div class="grid"><section class="card"><h3>Community eligibility</h3><p>You self-attested eligibility for this women-only community. Kitty does not infer gender, safety, or good conduct from identity documents. Reports are reviewed under moderation policy.</p>${pill('Self-attested','amber')}</section><section class="card"><h3>Identity verification</h3><p>Identity verification is not configured in this local preview. No ID documents or biometrics are collected here.</p>${pill('Not configured','amber')}</section><section class="card"><h3>One-time access</h3><p>${rupees(status.price.amountPaise)} onboarding, then lifetime access after separate approval and activation. No annual renewal or recurring mandate. Checkout is closed.</p>${pill('Checkout closed','amber')}</section></div><div class="section-head"><h2>Your data</h2></div><div class="actions"><button class="secondary" id="contact">Contact sharing</button><button class="secondary" id="export">Export my data</button><button class="secondary" id="delete">Delete demo account</button></div><p class="small muted">Contact details are visible only to members of your circles when you choose to share them.</p>`;document.querySelector('#contact').onclick=()=>openModal('Contact sharing',`${field('Contact detail','value','text','maxlength="160"')}<label class="check"><input type="checkbox" name="consent"> Share with members of my circles</label>`,async f=>{await api('/contact',{value:f.value,consent:f.consent==='on'});notice('Contact preference saved')});document.querySelector('#export').onclick=()=>run(async()=>{const data=await api('/export');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='kitty-my-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});document.querySelector('#delete').onclick=()=>{if(!confirm('Delete this synthetic account? Transfer sole host roles first.'))return;run(async()=>{await api('/account/delete',{});current=null;await refreshUsers();notice('Synthetic account deleted');render()})}}
async function renderAccountProfile(){
  const {user}=await api('/me');
  content.querySelector('.profile-editor')?.remove();
  const profile=user.profile || {};
  const socials=profile.socials || {};
  const card=document.createElement('section');
  card.className='card profile-editor';
  card.innerHTML='<h2>Your private introduction</h2><p>Only verified members of a circle can review this snapshot after you apply and agree to share it. Editing later does not change an existing vote.</p><form id="profile-form" class="form-grid"><label>About you<textarea name="bio" maxlength="500">'+esc(profile.bio || '')+'</textarea></label><label>Instagram handle<input name="instagram" maxlength="40" value="'+esc(socials.instagram || '')+'"></label><label>Facebook handle<input name="facebook" maxlength="40" value="'+esc(socials.facebook || '')+'"></label><label>Snapchat handle<input name="snapchat" maxlength="40" value="'+esc(socials.snapchat || '')+'"></label><p class="small muted">Face-photo upload and WhatsApp verification need private storage and a real verification provider; they are not active in this local demo.</p><button class="primary" type="submit">Save profile</button></form>';
  content.querySelector('.grid').after(card);
  card.querySelector('form').onsubmit=event=>{event.preventDefault();run(async()=>{const fields=Object.fromEntries(new FormData(event.currentTarget));await api('/profile',{bio:fields.bio,socials:{instagram:fields.instagram,facebook:fields.facebook,snapchat:fields.snapchat}});notice('Profile saved');await renderAccountProfile()})};
}
function renderHosted(status){
  hostedBishiEnabled = status.bishi === true;
  hostedSsoEnabled = status.sso === true;
  hostedMember = null;
  document.body.classList.add('hosted');
  content.innerHTML=`<div class="hosted-layout"><section class="hosted-intro"><p class="eyebrow">Kitty by Grasany</p><h1>Good company, beautifully planned.</h1><p class="lead">A thoughtful space for women to bring existing kitty circles together, discover open meetups, take turns hosting, and keep shared plans clear.</p><div class="hosted-flags"><span>Women-only community</span><span>Private group spaces</span><span>One-time access plan</span></div><div class="note">Kitty is in a public product preview. Account registration, identity verification, group access, and checkout are closed while the dedicated services are being connected and tested.</div></section><div class="hosted-art"><div class="art-stars">✦ &nbsp; ✧ &nbsp; ✦</div><img src="/kitty-mark.svg" alt="Kitty cat emblem"><div class="art-line">A little charm. A lot of care.</div><div class="lipstick" aria-hidden="true"></div></div></div><div class="hosted-cards"><article class="card"><span class="eyebrow">01 · Gather</span><h3>Your circle, your pace</h3><p>Keep existing groups private, or open a meetup for new members with approval and capacity controls.</p></article><article class="card"><span class="eyebrow">02 · Host</span><h3>Take turns, beautifully</h3><p>Plan themes, dates, venues, reservations and RSVPs. Track each member's turn to host.</p></article><article class="card"><span class="eyebrow">03 · Keep clear</span><h3>Shared records</h3><p>See contributions, split expenses and settlement records without Kitty holding group money.</p></article></div><div class="hosted-foot"><strong>Planned access: ${rupees(status.price.amountPaise)} once, then lifetime access.</strong><span>No annual renewal or recurring mandate. Checkout is not open.</span></div><p class="small muted">Bishi pool tracking and draws are closed pending group-specific legal authorization. Kitty does not collect or transfer pooled funds.</p>`;
  window.mountCatArt?.(content.querySelector('.hosted-art'));
  if (status.sso) {
    const gate = document.createElement('div');
    gate.className = 'hosted-account';
    content.querySelector('.hosted-intro .note').after(gate);
    api('/auth/session').then(({ member }) => {
      if (!member) {
        gate.innerHTML = '<a class="primary" href="/auth/start">Sign in with Grasany</a>';
        return;
      }
      hostedMember = member;
      const needsAttestation = !member.adultAttested || !member.womenOnlyAttested;
      gate.innerHTML = `<strong>Welcome, ${esc(member.name)}.</strong><p>Your account is signed in. Circle access opens only after the required verification and payment approvals.</p>${needsAttestation ? '<label class="check"><input type="checkbox" id="attest-adult"> I confirm I am at least 18 years old.</label><label class="check"><input type="checkbox" id="attest-woman"> I self-attest that I am eligible for this women-only community.</label><button class="primary" id="save-attestation">Save my statements</button>' : `<p class="small muted">Identity: ${esc(member.identityStatus)} · Access: ${esc(member.accessStatus)}</p>`}<button class="text-btn" id="sign-out">Sign out</button>`;
      if (!needsAttestation) {
        renderHostedProfile();
        if (member.identityStatus === 'verified' && member.accessStatus === 'active') renderHostedWorkspace(member);
      }
      document.querySelector('#save-attestation')?.addEventListener('click', () => run(async () => {
        if (!document.querySelector('#attest-adult').checked || !document.querySelector('#attest-woman').checked) throw new Error('Both statements are required');
        await api('/account/attest', { adult: true, woman: true });
        notice('Statements saved');
        renderHosted(status);
      }));
      document.querySelector('#sign-out').onclick = () => run(async () => { await api('/auth/logout', {}); renderHosted(status); });
    }).catch(() => { gate.textContent = 'Sign-in is temporarily unavailable.'; });
  }
  renderHostedDiscovery();
}
function renderHostedDiscovery(){
  const section = document.createElement('section');
  section.className = 'hosted-public';
  section.innerHTML = `<p class="eyebrow">A peek inside</p><h2>Find your circle</h2><p class="lead">Search by city, area or circle name. Nearby search uses your location only when you choose it. Public results never include private venues or members' locations.</p><form class="discovery-form"><label>City, area or circle<input name="search" maxlength="80" placeholder="Mumbai, Bandra, Pune…" autocomplete="off"></label><label>Within<select name="radiusKm"><option value="10">10 km</option><option value="25" selected>25 km</option><option value="50">50 km</option><option value="100">100 km</option></select></label><div class="actions"><button class="primary" type="submit">Search</button><button class="secondary" type="button" id="nearby-circles">Use my location</button></div></form><p class="small muted" id="discovery-hint">Nearby results require an approximate public area pin chosen by a circle's host.</p><div class="grid" id="discovery-results" aria-live="polite"><p class="loading">Finding circles…</p></div>`;
  content.querySelector('.hosted-cards').before(section);
  const results = section.querySelector('#discovery-results');
  const renderResults = ({ groups = [], sessions = [] }, nearby = false) => {
    results.innerHTML = `${!nearby ? sessions.map(s => `<article class="card"><span class="pill">Open meetup</span><h3>${esc(s.title)}</h3><p>${esc(s.theme)}</p><p class="meta">${date(s.startsAt)} · ${esc(s.city)} · ${esc(s.available)} places</p></article>`).join('') : ''}${groups.map(g => `<article class="card"><span class="pill">Discoverable circle</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><p class="meta">${esc([g.area,g.city].filter(Boolean).join(', '))}${g.distanceKm !== null ? ` · About ${esc(g.distanceKm)} km away` : ''} · ${esc(g.available)} places · Typical ${rupees(g.avgMonthlyCostPaise)} / month</p><button class="text-btn" data-discovery-apply="${esc(g.id)}">Request to join →</button></article>`).join('')}` || empty('No circles found','Try another area or a wider distance.');
    results.querySelectorAll('[data-discovery-apply]').forEach(button => button.onclick = () => {
      if (!hostedMember) return hostedSsoEnabled ? window.location.assign('/auth/start') : notice('Sign-in is not open yet', true);
      const group = groups.find(g=>g.id===button.dataset.discoveryApply);
      hostedDialog(`Apply to ${group?.title || 'circle'}`, `<p class="small">Typical monthly cost: ${rupees(group?.avgMonthlyCostPaise)}.</p><label class="check"><input type="checkbox" name="shareProfile" required> Share my current profile and private photo with this circle's verified reviewers for this application.</label>`, async f=>{await api('/member?route=apply',{groupId:group.id,shareProfile:f.shareProfile==='on'});notice('Application shared for a member vote')}, async()=>{if(hostedMember.identityStatus==='verified' && hostedMember.accessStatus==='active')await renderHostedWorkspace(hostedMember)}, 'Apply');
    });
  };
  const search = async query => { results.innerHTML = '<p class="loading">Finding circles…</p>'; try { renderResults(await api(`/public?${query}`), Boolean(query && query !== 'search=')); } catch { results.innerHTML = '<p class="note">Circle search is temporarily unavailable.</p>'; } };
  section.querySelector('form').onsubmit = event => { event.preventDefault(); const term = section.querySelector('[name="search"]').value.trim(); search(new URLSearchParams({ search:term }).toString()); };
  section.querySelector('#nearby-circles').onclick = () => {
    if (!navigator.geolocation) return notice('Location is unavailable on this device', true);
    section.querySelector('#discovery-hint').textContent = 'Requesting your location for this search only…';
    navigator.geolocation.getCurrentPosition(position => {
      section.querySelector('#discovery-hint').textContent = 'Showing circles with a host-approved approximate area pin.';
      const radiusKm = section.querySelector('[name="radiusKm"]').value;
      search(new URLSearchParams({ lat:String(position.coords.latitude), lon:String(position.coords.longitude), radiusKm }).toString());
    }, () => { section.querySelector('#discovery-hint').textContent = 'Location was not shared. You can still search by city or area.'; }, { enableHighAccuracy:false, timeout:10000, maximumAge:300000 });
  };
  search('');
}
async function renderHostedProfile(){
  const mount = document.createElement('section');
  mount.className = 'card hosted-profile';
  content.querySelector('.hosted-layout').after(mount);
  try {
    const { profile } = await api('/account/profile');
    mount.innerHTML = `<h2>Your private profile</h2><p class="small muted">Your details are shared with a circle's verified reviewers only after you apply and agree to share them. A new photo cancels open applications so you can review what is shared.</p><form class="form-grid"><label>About you<textarea name="bio" maxlength="500">${esc(profile.bio)}</textarea></label><label>Instagram<input name="instagram" maxlength="40" value="${esc(profile.socials.instagram)}"></label><label>Facebook<input name="facebook" maxlength="40" value="${esc(profile.socials.facebook)}"></label><label>Snapchat<input name="snapchat" maxlength="40" value="${esc(profile.socials.snapchat)}"></label><button class="primary" type="submit">Save introduction</button></form><div class="photo-control"><strong>Photo with your face</strong>${profile.hasPhoto ? '<img src="/api/account/photo" alt="Your private profile photo">' : '<p class="small muted">No photo added yet.</p>'}<label class="small">Choose a JPEG, PNG or WebP image, up to 2 MB<input type="file" accept="image/jpeg,image/png,image/webp"></label><button class="secondary" id="upload-photo" type="button">Save photo privately</button></div><p class="small muted">WhatsApp verification: ${profile.whatsappVerified ? 'verified' : 'waiting for a configured verification provider'}. Kitty does not label an unverified number as verified.</p>`;
    mount.querySelector('form').onsubmit = event => { event.preventDefault(); run(async () => { const f = Object.fromEntries(new FormData(event.currentTarget)); await api('/account/profile', f); notice('Introduction saved'); }); };
    mount.querySelector('#upload-photo').onclick = () => run(async () => {
      const file = mount.querySelector('input[type="file"]').files?.[0];
      if (!file || file.size > 2_097_152) throw new Error('Choose a photo up to 2 MB');
      const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      await api('/account/photo', { imageBase64: encoded });
      notice('Photo saved privately');
      mount.remove();
      renderHostedProfile();
    });
    if (profile.hasPhoto) {
      const remove = document.createElement('button');
      remove.className = 'text-btn';
      remove.type = 'button';
      remove.textContent = 'Remove my photo';
      mount.querySelector('.photo-control').appendChild(remove);
      remove.onclick = () => run(async () => {
        const response = await fetch('/api/account/photo', { method: 'DELETE' });
        if (!response.ok) throw new Error((await response.json()).error || 'photo_unavailable');
        notice('Photo removed');
        mount.remove();
        renderHostedProfile();
      });
    }
  } catch { mount.innerHTML = '<p>Profile editing is temporarily unavailable.</p>'; }
}

function hostedDialog(title, fields, save, refresh, action='Save') {
  document.querySelector('#modal-content').innerHTML = `<h2>${esc(title)}</h2><div class="form-grid">${fields}</div>`;
  document.querySelector('#submit').textContent = action;
  modalForm.onsubmit = event => {
    event.preventDefault();
    run(async () => {
      await save(Object.fromEntries(new FormData(modalForm)));
      modal.close();
      await refresh();
    });
  };
  modal.showModal();
}

async function renderHostedWorkspace(member) {
  content.querySelector('.hosted-workspace')?.remove();
  const mount = document.createElement('section');
  mount.className = 'hosted-workspace';
  content.querySelector('.hosted-cards').before(mount);
  mount.innerHTML = '<p class="loading">Loading your circles…</p>';
  try {
    const [home, publicData] = await Promise.all([api('/member?route=home'), api('/public')]);
    const myGroups = home.groups || [];
    const applications = home.applications || [];
    const discoverable = publicData.groups || [];
    mount.innerHTML = `<div class="section-head"><div><p class="eyebrow">Your Kitty space</p><h2>Circles and invitations</h2></div><button class="primary" id="hosted-create">Start a circle</button></div>
      <p class="small muted">Your photo and social details remain private until you apply to a circle and agree to share a snapshot with its verified reviewers.</p>
      <div class="grid">${myGroups.map(g => `<article class="card"><span class="pill">${esc(g.role)}</span><h3>${esc(g.title)}</h3><p>${esc(g.city)} · Typical ${rupees(g.avgMonthlyCostPaise)} / month</p><button class="text-btn" data-open-group="${g.id}">Open circle →</button></article>`).join('') || empty('No circles yet','You can start one or explore a discoverable circle.')}</div>
      <div class="section-head"><h2>Your applications</h2></div><div class="list">${applications.map(a => `<div class="list-item"><div><strong>${esc(a.groupTitle)}</strong><small>${esc(a.status)}${a.reapplyAfter ? ` · May reapply after ${date(a.reapplyAfter)}` : ''}</small></div>${['requested','waitlisted'].includes(a.status) ? `<button class="text-btn" data-withdraw="${a.id}">Withdraw</button>` : ''}</div>`).join('') || empty('No applications','Apply to any circle that feels right for you.')}</div>
      <div class="section-head"><h2>Discoverable circles</h2></div>${!home.profileReady ? '<div class="note">To apply, add a private face photo and complete WhatsApp verification. Applications remain closed until verification is configured.</div>' : ''}<div class="grid">${discoverable.map(g => `<article class="card"><span class="pill">${esc(g.city)}</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p><p class="meta">${g.members} / ${g.limit} members · Typical ${rupees(g.avgMonthlyCostPaise)} / month · Extras: ${esc(g.expenseSplitBasis)}</p><button class="text-btn" data-apply-group="${g.id}" ${home.profileReady ? '' : 'disabled'}>Apply to join →</button></article>`).join('') || empty('No public circles yet','New circles will appear here when their hosts choose discoverability.')}</div>`;
    mount.querySelector('#hosted-create').onclick = () => hostedDialog('Start a circle',
      `${field('Circle name','title','text','maxlength="80"')}${textArea('About this circle','description','maxlength="500"')}${field('City','city','text','maxlength="80"')}<label>Public area (optional)<input name="area" maxlength="80" placeholder="Bandra West"></label><label>Member limit<input name="limit" type="number" min="2" max="100" value="8" required></label><label>Typical monthly cost in rupees<input name="monthlyCost" type="number" min="0" step="0.01" value="0" required></label><label>Extras split among<select name="expenseSplitBasis"><option value="members">Active members</option><option value="attendees">Meetup attendees who RSVP going</option></select></label><label>Visibility<select name="visibility"><option value="discoverable">Discoverable</option><option value="private">Private</option></select></label><label>Shared rules<textarea name="rules" maxlength="2000"></textarea></label>`,
      async f => { await api('/member?route=create', { title:f.title, description:f.description, city:f.city, area:f.area, limit:Number(f.limit), avgMonthlyCostPaise:Math.round(Number(f.monthlyCost)*100), expenseSplitBasis:f.expenseSplitBasis, visibility:f.visibility, rules:f.rules }); notice('Circle created'); },
      () => renderHostedWorkspace(member), 'Create circle');
    mount.querySelectorAll('[data-open-group]').forEach(button => button.onclick = () => renderHostedGroup(button.dataset.openGroup, mount, member));
    mount.querySelectorAll('[data-withdraw]').forEach(button => button.onclick = () => run(async () => { await api('/member?route=join-cancel', { requestId:button.dataset.withdraw }); notice('Application withdrawn'); await renderHostedWorkspace(member); }));
    mount.querySelectorAll('[data-apply-group]').forEach(button => button.onclick = () => {
      const group = discoverable.find(g => g.id === button.dataset.applyGroup);
      hostedDialog(`Apply to ${group?.title || 'circle'}`,
        `<p class="small">Typical monthly cost: ${rupees(group?.avgMonthlyCostPaise)}. Extras are split among ${esc(group?.expenseSplitBasis)}.</p><label class="check"><input type="checkbox" name="shareProfile" required> Share my current profile and private photo with this circle's verified reviewers for this application.</label>`,
        async f => { await api('/member?route=apply', { groupId:button.dataset.applyGroup, shareProfile:f.shareProfile==='on' }); notice('Application shared for a member vote'); },
        () => renderHostedWorkspace(member), 'Apply');
    });
  } catch { mount.innerHTML = '<p class="note">Your circles are temporarily unavailable.</p>'; }
}

async function renderHostedGroup(groupId, mount, member) {
  mount.innerHTML = '<p class="loading">Opening your circle…</p>';
  try {
    const [{ group, members, events, expenses }, reviews, rejections] = await Promise.all([
      api(`/member?route=group&groupId=${encodeURIComponent(groupId)}`),
      api(`/member?route=review&groupId=${encodeURIComponent(groupId)}`).catch(() => null),
      api(`/member?route=rejections&groupId=${encodeURIComponent(groupId)}`).catch(() => null),
    ]);
    const memberName = id => members.find(m => m.id === id)?.name || 'Member';
    const refresh = () => renderHostedGroup(groupId, mount, member);
    mount.innerHTML = `<button class="text-btn" id="hosted-back">← All circles</button><div class="section-head"><div><p class="eyebrow">Your circle</p><h2>${esc(group.title)}</h2><p class="small muted">${esc([group.area,group.city].filter(Boolean).join(', '))} · ${members.length} / ${group.limit} members · Typical ${rupees(group.avgMonthlyCostPaise)} / month · Extras split among ${esc(group.expenseSplitBasis)}</p></div></div>
      <div class="note">${esc(group.rules || 'No shared rules added yet.')} Private venue details appear only to members.</div>
      ${group.myRole==='host' && group.visibility==='discoverable' ? `<div class="public-area-control"><p class="small muted">Nearby discovery: ${group.nearbyDiscoverable ? 'on, using an approximate public area pin' : 'off'}. Your exact venue is never used.</p><div class="actions"><button class="secondary" id="set-public-pin">${group.nearbyDiscoverable ? 'Update approximate area' : 'Enable nearby discovery'}</button>${group.nearbyDiscoverable ? '<button class="text-btn" id="remove-public-pin">Remove nearby pin</button>' : ''}</div></div>` : ''}
      <div class="section-head"><h2>Members</h2></div><div class="grid">${members.map(m => `<article class="card"><strong>${esc(m.name)}</strong><p class="small muted">${esc(m.role)}</p></article>`).join('')}</div>
      <div class="section-head"><h2>Meetups</h2><button class="secondary" id="hosted-event">Plan meetup</button></div><div class="list">${events.map(e => `<div class="list-item"><div><strong>${esc(e.title)}</strong><small>${date(e.startsAt)} · ${esc(e.status)} · ${e.goingCount}/${e.capacity} going${e.location ? ` · ${esc(e.location)}` : ''}</small></div>${e.status==='scheduled' && new Date(e.startsAt) > new Date() ? `<div class="actions"><button class="text-btn" data-rsvp="${e.id}" data-response="going">Going</button><button class="text-btn" data-rsvp="${e.id}" data-response="maybe">Maybe</button><button class="text-btn" data-rsvp="${e.id}" data-response="not_going">Can't make it</button></div>` : ''}</div>`).join('') || empty('No meetups yet','Any active member can plan the next gathering.')}</div>
      <div class="section-head"><h2>Shared extras</h2><button class="secondary" id="hosted-expense">Propose expense</button></div><p class="small muted">These are group records, not payments handled by Kitty. Every included member confirms their share before an expense is agreed.</p><div class="list">${expenses.map(e => { const mine=e.splits.find(s=>s.memberId===member.id); return `<div class="list-item"><div><strong>${esc(e.title)} · ${rupees(e.amountPaise)}</strong><small>${esc(e.status)} · Paid by ${esc(memberName(e.paidBy))} · ${e.splits.filter(s=>s.approved).length}/${e.splits.length} shares confirmed${mine ? ` · Your share ${rupees(mine.amountPaise)}` : ''}</small></div>${mine && ['proposed','agreed'].includes(e.status) ? `<div class="actions">${e.status==='proposed' && !mine.approved ? `<button class="primary" data-expense-approve="${e.id}">Confirm my share</button>` : ''}<button class="text-btn" data-expense-dispute="${e.id}">Question split</button></div>` : ''}</div>`; }).join('') || empty('Nothing to split yet','Add an extra cost when the group has agreed on a meetup or plan.')}</div>
      <div class="section-head"><h2>Membership reviews</h2></div><div class="grid">${reviews ? (reviews.requests||[]).map(r => `<article class="card"><span class="pill">${esc(r.status)}</span><h3>${esc(r.profile.name)}</h3>${r.profile.photoUrl ? `<img class="review-photo" src="${esc(r.profile.photoUrl)}" alt="Applicant's shared profile photo">` : ''}<p>${esc(r.profile.bio || '')}</p><p class="small muted">Instagram: ${esc(r.profile.socials?.instagram || '—')} · Facebook: ${esc(r.profile.socials?.facebook || '—')} · Snapchat: ${esc(r.profile.socials?.snapchat || '—')} · WhatsApp: ${r.profile.whatsappVerified ? 'verified' : 'unverified'}</p><p class="small muted">${r.yesVotes}/${r.requiredVotes} yes votes needed · ${r.votes} votes cast</p>${r.mayVote ? `<div class="actions"><button class="primary" data-review-vote="${r.id}" data-approve="true">Welcome her</button><button class="secondary" data-review-vote="${r.id}" data-approve="false">Not this time</button></div>` : ''}</article>`).join('') || empty('No open reviews','Every eligible verified member can vote when someone applies.') : '<p class="note">Reviews are temporarily unavailable. Please try again shortly.</p>'}</div>
      ${group.myRole==='host' ? `<div class="section-head"><h2>Reconsider a rejection</h2></div><div class="list">${rejections ? (rejections.requests||[]).map(r => `<div class="list-item"><div><strong>${esc(r.name)}</strong><small>Cooldown through ${date(r.reapplyAfter)}</small></div><button class="text-btn" data-override="${r.id}">Review override</button></div>`).join('') || empty('No current rejections','An override requires a recorded reason and an available place.') : '<p class="note">Rejection records are temporarily unavailable.</p>'}</div>` : ''}`;
    mount.querySelector('#hosted-back').onclick = () => renderHostedWorkspace(member);
    mount.querySelector('#set-public-pin')?.addEventListener('click', () => {
      if (!navigator.geolocation) return notice('Location is unavailable on this device', true);
      navigator.geolocation.getCurrentPosition(position => run(async () => {
        await api('/member?route=location-update', { groupId, area:group.area, latitude:position.coords.latitude, longitude:position.coords.longitude });
        notice('Approximate area enabled'); await refresh();
      }), () => notice('Location was not shared', true), { enableHighAccuracy:false, timeout:10000, maximumAge:300000 });
    });
    mount.querySelector('#remove-public-pin')?.addEventListener('click', () => run(async () => {
      await api('/member?route=location-update', { groupId, area:group.area, remove:true }); notice('Nearby pin removed'); await refresh();
    }));
    mount.querySelector('#hosted-event').onclick = () => hostedDialog('Plan a meetup',
      `${field('Meetup title','title','text','maxlength="120"')}<label>Theme (optional)<input name="theme" maxlength="160"></label><label>Date and time<input name="startsAt" type="datetime-local" required></label><label>Places<input name="capacity" type="number" min="1" max="${group.limit}" value="${group.limit}" required></label><label>Private venue (optional)<input name="location" maxlength="300"></label><label>Reservation note (optional)<input name="reservation" maxlength="500"></label>`,
      async f => { await api('/member?route=event-create', { groupId, title:f.title, theme:f.theme, startsAt:new Date(f.startsAt).toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, capacity:Number(f.capacity), location:f.location, reservation:f.reservation }); notice('Meetup planned'); }, refresh, 'Plan meetup');
    mount.querySelectorAll('[data-rsvp]').forEach(button => button.onclick = () => run(async () => { await api('/member?route=event-rsvp', { eventId:button.dataset.rsvp, response:button.dataset.response }); notice('RSVP saved'); await refresh(); }));
    mount.querySelector('#hosted-expense').onclick = () => hostedDialog('Propose a shared extra',
      `${field('Expense title','title','text','maxlength="120"')}${field('Amount in rupees','rupees','number','min="0.01" step="0.01"')}${group.expenseSplitBasis==='attendees' ? `<label>Meetup<select name="eventId" required>${events.filter(e=>e.status!=='cancelled').map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select></label>` : ''}<p class="small muted">The included people are snapshotted when you propose this expense. Each confirms her own share.</p>`,
      async f => { await api('/member?route=expense-propose', { groupId, title:f.title, amountPaise:Math.round(Number(f.rupees)*100), eventId:f.eventId || null }); notice('Expense proposed'); }, refresh, 'Propose expense');
    mount.querySelectorAll('[data-expense-approve]').forEach(button => button.onclick = () => run(async () => { await api('/member?route=expense-decision', { expenseId:button.dataset.expenseApprove, approve:true }); notice('Your share confirmed'); await refresh(); }));
    mount.querySelectorAll('[data-expense-dispute]').forEach(button => button.onclick = () => hostedDialog('Question this split', `<label>What should the group discuss?<textarea name="reason" maxlength="300" required></textarea></label>`, async f => { await api('/member?route=expense-decision', { expenseId:button.dataset.expenseDispute, approve:false, reason:f.reason }); notice('Split marked for discussion'); }, refresh, 'Flag for discussion'));
    mount.querySelectorAll('[data-review-vote]').forEach(button => button.onclick = () => run(async () => { await api('/member?route=vote', { requestId:button.dataset.reviewVote, approve:button.dataset.approve==='true' }); notice('Your vote was recorded'); await refresh(); }));
    mount.querySelectorAll('[data-override]').forEach(button => button.onclick = () => hostedDialog('Reconsider this application', `<p class="small muted">An override is logged and needs an available place. It should be used thoughtfully.</p><label>Reason<textarea name="reason" maxlength="300" required></textarea></label>`, async f => { await api('/member?route=override', { requestId:button.dataset.override, reason:f.reason }); notice('Override recorded'); }, refresh, 'Admit member'));
    renderBishiGroup(groupId, mount, member, refresh);
  } catch { mount.innerHTML = '<p class="note">This circle is temporarily unavailable.</p><button class="text-btn" id="hosted-back">← All circles</button>'; mount.querySelector('#hosted-back').onclick = () => renderHostedWorkspace(member); }
}
async function renderBishiGroup(groupId, mount, member, refresh){
  const panel = document.createElement('section');
  panel.className = 'bishi-panel';
  mount.appendChild(panel);
  if (!hostedBishiEnabled) {
    panel.innerHTML = '<div class="section-head"><h2>Bishi pool records</h2></div><p class="note">Money pool plans and draws are closed until Kitty has the required legal clearance for this specific circle. Kitty will only keep records; members handle money outside Kitty.</p>';
    return;
  }
  try {
    const { plan } = await api(`/member?route=bishi&groupId=${encodeURIComponent(groupId)}`);
    const act = async (action, extra={}, shouldRefresh=true) => { await api('/member?route=bishi', { groupId, action, ...extra }); if (shouldRefresh) await refresh(); };
    if (!plan) {
      panel.innerHTML = '<div class="section-head"><h2>Bishi pool records</h2><button class="secondary" id="bishi-propose">Propose a plan</button></div><p class="small muted">A group-specific legal authorization and every participant’s consent are required before a plan can start. Kitty never receives the pooled money.</p>';
      panel.querySelector('#bishi-propose').onclick = () => hostedDialog('Propose a Bishi plan', `${field('Amount per person in rupees','rupees','number','min="1" step="0.01"')}<label>Round frequency<select name="cadence"><option value="monthly">Monthly</option><option value="fortnightly">Every two weeks</option><option value="weekly">Weekly</option></select></label><label>First round date<input name="startsOn" type="date" required></label><p class="small muted">All current members must consent. Real-money plans require the group’s legal authorization before a proposal can be recorded.</p>`, async f => { await act('propose',{ amountPaise:Math.round(Number(f.rupees)*100),cadence:f.cadence,startsOn:f.startsOn },false); notice('Plan proposed'); }, refresh, 'Propose plan');
      return;
    }
    const names = Object.fromEntries(plan.participants.map(p => [p.memberId,p.name]));
    const mine = plan.participants.find(p=>p.memberId===member.id);
    panel.innerHTML = `<div class="section-head"><div><p class="eyebrow">Member-led money records</p><h2>Bishi · ${esc(plan.status)}</h2></div></div><p class="small muted">${rupees(plan.amountPaise)} per member · ${esc(plan.cadence)} · starts ${esc(plan.startsOn)} · ${plan.participants.length} participants. Money stays outside Kitty.</p>
      ${plan.status==='proposed' ? `<div class="list">${plan.participants.map(p=>`<div class="list-item"><strong>${esc(p.name)}</strong><small>${p.consented?'Agreed':'Waiting for consent'}</small></div>`).join('')}</div><div class="actions"><button class="secondary" id="bishi-consent">${mine?.consented ? 'Withdraw my consent' : 'Agree to this plan'}</button>${plan.participants.every(p=>p.consented) ? '<button class="primary" id="bishi-activate">Start rounds</button>' : ''}</div>` : ''}
      <div class="list">${plan.rounds.map(r=>{const own=r.contributions.find(c=>c.memberId===member.id); const allConfirmed=r.contributions.length===plan.participants.length && r.contributions.every(c=>c.confirmed);return `<article class="card bishi-round"><span class="pill">Round ${r.number} · ${esc(r.status)}</span><h3>${esc(r.scheduledFor)} · Pool target ${rupees(r.poolTargetPaise)}</h3><p class="small muted">${r.contributions.filter(c=>c.confirmed).length}/${r.contributions.length} contributions independently confirmed${r.winnerId?` · Drawn member: ${esc(names[r.winnerId]||'Member')}`:''}</p><details><summary>Draw record</summary><p class="small muted">Commitment: ${esc(r.commitment)}</p>${r.revealedSeed?`<p class="small muted">Revealed seed: ${esc(r.revealedSeed)}</p>`:'<p class="small muted">Seed appears after the draw.</p>'}</details><div class="actions">${r.status==='planned' && own && !own.reported ? `<button class="secondary" data-bishi-report="${r.id}">I contributed outside Kitty</button>`:''}${r.status==='planned' && allConfirmed && r.scheduledFor<=new Date().toISOString().slice(0,10) ? `<button class="primary" data-bishi-draw="${r.id}">Draw next member</button>`:''}${r.status==='drawn' && r.reportedPayoutPaise===null ? `<button class="secondary" data-bishi-payout="${r.id}">Record outside payout</button>`:''}${r.status==='drawn' && r.reportedPayoutPaise!==null && !r.payoutConfirmed && r.winnerId===member.id ? `<button class="primary" data-bishi-receipt="${r.id}">Confirm I received ${rupees(r.reportedPayoutPaise)}</button>`:''}</div>${r.status==='planned'?`<div class="bishi-contributions">${r.contributions.map(c=>`<div class="list-item"><div><strong>${esc(names[c.memberId]||'Member')}</strong><small>${c.confirmed?'Confirmed':c.reported?'Reported, awaiting another member':'Not reported'}</small></div>${c.reported && !c.confirmed && c.memberId!==member.id ? `<button class="text-btn" data-bishi-confirm="${r.id}" data-member-id="${c.memberId}">Confirm contribution</button>`:''}</div>`).join('')}</div>`:''}</article>`}).join('')}</div>`;
    panel.querySelector('#bishi-consent')?.addEventListener('click', () => run(async()=>{await act('consent',{agree:!mine.consented});notice('Your choice was recorded')}));
    panel.querySelector('#bishi-activate')?.addEventListener('click', () => run(async()=>{await act('activate');notice('Rounds started')}));
    panel.querySelectorAll('[data-bishi-report]').forEach(button=>button.onclick=()=>run(async()=>{await act('report_contribution',{roundId:button.dataset.bishiReport});notice('Contribution reported')}));
    panel.querySelectorAll('[data-bishi-confirm]').forEach(button=>button.onclick=()=>run(async()=>{await act('confirm_contribution',{roundId:button.dataset.bishiConfirm,memberId:button.dataset.memberId});notice('Contribution confirmed')}));
    panel.querySelectorAll('[data-bishi-draw]').forEach(button=>button.onclick=()=>run(async()=>{await act('draw',{roundId:button.dataset.bishiDraw});notice('Draw recorded')}));
    panel.querySelectorAll('[data-bishi-payout]').forEach(button=>button.onclick=()=>{const round=plan.rounds.find(r=>r.id===button.dataset.bishiPayout);hostedDialog('Record payout outside Kitty', `<p class="small muted">This is a record only. Kitty does not collect or send money. Target pool: ${rupees(round.poolTargetPaise)}.</p>${field('Amount paid in rupees','rupees','number',`min="1" max="${round.poolTargetPaise/100}" step="0.01"`)}`, async f=>{await act('report_payout',{roundId:round.id,amountPaise:Math.round(Number(f.rupees)*100)},false);notice('Outside payout reported')},refresh,'Record payout')});
    panel.querySelectorAll('[data-bishi-receipt]').forEach(button=>button.onclick=()=>run(async()=>{await act('confirm_payout',{roundId:button.dataset.bishiReceipt});notice('Receipt confirmed')}));
  } catch { panel.innerHTML = '<div class="section-head"><h2>Bishi pool records</h2></div><p class="note">Bishi records are temporarily unavailable.</p>'; }
}
run(async()=>{const status=await api('/status');if(status.mode!=='local_synthetic_demo')return renderHosted(status);await refreshUsers();await render()});
