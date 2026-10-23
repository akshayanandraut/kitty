import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../lib/member-routes/profile.js';
import create from '../lib/member-routes/create.js';
import apply from '../lib/member-routes/apply.js';
import review from '../lib/member-routes/review.js';
import vote from '../lib/member-routes/vote.js';
import override from '../lib/member-routes/override.js';
import memberRoute from '../api/member.js';
import photo, { prepareFacePhoto } from '../lib/member-routes/photo.js';
import home from '../lib/member-routes/home.js';
import group from '../lib/member-routes/group.js';
import eventCreate from '../lib/member-routes/event-create.js';
import eventRsvp from '../lib/member-routes/event-rsvp.js';
import expensePropose from '../lib/member-routes/expense-propose.js';
import expenseDecision from '../lib/member-routes/expense-decision.js';
import joinCancel from '../lib/member-routes/join-cancel.js';
import rejections from '../lib/member-routes/rejections.js';
import { splitEvenly } from '../lib/member-routes/group-shared.js';
import { discoveryQuery, publicAreaPin } from '../lib/discovery.js';
import { drawWinner, newDrawSeed, scheduledRound } from '../lib/bishi.js';
import bishi from '../lib/member-routes/bishi.js';
import locationUpdate from '../lib/member-routes/location-update.js';
import leave from '../lib/member-routes/leave.js';
import hostHandover from '../lib/member-routes/host-handover.js';
import sharp from 'sharp';

function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('production member routes reject anonymous reads and foreign-origin writes before database access', async () => {
  for (const handler of [profile, photo, review, home, group, rejections, hostHandover, bishi]) {
    const res = response();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'sign_in_required');
  }
  for (const handler of [profile, photo, create, apply, vote, override, eventCreate, eventRsvp, expensePropose, expenseDecision, joinCancel, locationUpdate, leave, hostHandover, bishi]) {
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://other.example' }, body: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'origin_denied');
  }
  const remove = response();
  await photo({ method: 'DELETE', headers: { origin: 'https://other.example' } }, remove);
  assert.equal(remove.statusCode, 403);
});

test('location search validates coordinates and stores an approximate area pin', () => {
  assert.deepEqual(discoveryQuery({ search:'  Bandra   West  ' }), { search:'Bandra West', nearby:null });
  assert.deepEqual(discoveryQuery({ lat:'19.12', lon:'72.88', radiusKm:'25' }), { search:'', nearby:{lat:19.12,lon:72.88,radiusKm:25} });
  assert.deepEqual(publicAreaPin(19.12345,72.87654), { latitude:19.12, longitude:72.88 });
  assert.throws(() => discoveryQuery({ lat:'91',lon:'72' }), /invalid_location/);
  assert.throws(() => discoveryQuery({ lat:'19',lon:'' }), /invalid_location/);
  assert.throws(() => discoveryQuery({ lat:'19',lon:'72',radiusKm:'500' }), /invalid_location/);
});

test('Bishi draw verifies its commitment and schedules month ends', () => {
  const seed = newDrawSeed();
  const people = ['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
  const planId = '00000000-0000-4000-8000-000000000004';
  const first = drawWinner(seed.secret,seed.commitment,planId,1,people);
  assert.equal(drawWinner(seed.secret,seed.commitment,planId,1,[...people].reverse()), first);
  assert.notEqual(drawWinner(seed.secret,seed.commitment,planId,2,people,[first]), first);
  assert.throws(() => drawWinner(seed.secret,'0'.repeat(64),planId,1,people), /invalid_draw_seed/);
  assert.equal(scheduledRound('2027-01-31','monthly',1),'2027-02-28');
  assert.equal(scheduledRound('2027-01-31','monthly',2),'2027-03-31');
  assert.equal(scheduledRound('2027-01-31','fortnightly',1),'2027-02-14');
});

test('shared costs add to the exact amount and reject duplicate or invalid participants', () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  const c = '00000000-0000-4000-8000-000000000003';
  const splits = splitEvenly(100, [c, b, a]);
  assert.deepEqual(splits, [
    { memberId: a, amountPaise: 34 },
    { memberId: b, amountPaise: 33 },
    { memberId: c, amountPaise: 33 },
  ]);
  assert.equal(splits.reduce((sum, part) => sum + part.amountPaise, 0), 100);
  assert.throws(() => splitEvenly(1, [a, b]), /invalid_amount/);
  assert.throws(() => splitEvenly(100, [a, a]), /invalid_participants/);
  assert.throws(() => splitEvenly(100, [a, 'bad']), /invalid_participants/);
});

test('face-photo processing accepts pixels and rejects non-images before storage', async () => {
  const jpg = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#bb7799' } }).jpeg().toBuffer();
  const content = await prepareFacePhoto(jpg.toString('base64'));
  const metadata = await sharp(content).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 600);
  await assert.rejects(prepareFacePhoto(Buffer.from('<svg/>').toString('base64')));
});

test('combined Vercel member function dispatches only known routes', async () => {
  const absent = response();
  await memberRoute({ method: 'GET', query: { route: 'unknown' }, headers: {} }, absent);
  assert.equal(absent.statusCode, 404);
  const profileResponse = response();
  await memberRoute({ method: 'GET', query: { route: 'profile' }, headers: {} }, profileResponse);
  assert.equal(profileResponse.statusCode, 401);
  const leaveResponse = response();
  await memberRoute({ method: 'POST', query: { route: 'leave' }, headers: { origin: 'https://other.example' }, body: {} }, leaveResponse);
  assert.equal(leaveResponse.statusCode, 403);
});
