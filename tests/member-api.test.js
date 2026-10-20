import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../api/account/profile.js';
import create from '../api/groups/create.js';
import apply from '../api/groups/apply.js';
import review from '../api/groups/review.js';
import vote from '../api/groups/vote.js';
import override from '../api/groups/override.js';

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
