import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../lib/member-routes/profile.js';
import create from '../lib/member-routes/create.js';
import apply from '../lib/member-routes/apply.js';
import review from '../lib/member-routes/review.js';
import vote from '../lib/member-routes/vote.js';
import override from '../lib/member-routes/override.js';
import memberRoute from '../api/member.js';

function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('production member routes reject anonymous reads and foreign-origin writes before database access', async () => {
  for (const handler of [profile, review]) {
    const res = response();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'sign_in_required');
  }
  for (const handler of [profile, create, apply, vote, override]) {
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://other.example' }, body: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'origin_denied');
  }
});

test('combined Vercel member function dispatches only known routes', async () => {
  const absent = response();
  await memberRoute({ method: 'GET', query: { route: 'unknown' }, headers: {} }, absent);
  assert.equal(absent.statusCode, 404);
  const profileResponse = response();
  await memberRoute({ method: 'GET', query: { route: 'profile' }, headers: {} }, profileResponse);
  assert.equal(profileResponse.statusCode, 401);
});
