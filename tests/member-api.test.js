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
import sharp from 'sharp';

function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('production member routes reject anonymous reads and foreign-origin writes before database access', async () => {
  for (const handler of [profile, photo, review]) {
    const res = response();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'sign_in_required');
  }
  for (const handler of [profile, photo, create, apply, vote, override]) {
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://other.example' }, body: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'origin_denied');
  }
  const remove = response();
  await photo({ method: 'DELETE', headers: { origin: 'https://other.example' } }, remove);
  assert.equal(remove.statusCode, 403);
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
});
