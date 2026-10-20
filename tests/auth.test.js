import test from 'node:test';
import assert from 'node:assert/strict';
import start from '../api/auth/start.js';
import callback from '../api/auth/callback.js';
import session from '../api/auth/session.js';
import attest from '../api/account/attest.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('central sign-in stays closed without an issued Kitty client', async () => {
  const previous = process.env.KITTY_OIDC_CLIENT_ID;
  delete process.env.KITTY_OIDC_CLIENT_ID;
  try {
    const first = response();
    await start({ method: 'GET', headers: {} }, first);
    assert.equal(first.statusCode, 503);
    assert.equal(first.body.error, 'identity_unconfigured');
    assert.equal(first.headers.Location, undefined);
    const second = response();
    await callback({ method: 'GET', headers: {}, query: {} }, second);
    assert.equal(second.statusCode, 503);
    assert.equal(second.body.error, 'identity_unconfigured');
  } finally {
    if (previous) process.env.KITTY_OIDC_CLIENT_ID = previous;
  }
});

test('an unauthenticated session reveals no member data', async () => {
  const res = response();
  await session({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.member, null);
});

test('self-attestation rejects cross-origin and incomplete submissions', async () => {
  const foreign = response();
  await attest({ method: 'POST', headers: { origin: 'https://attacker.example' }, body: { adult: true, woman: true } }, foreign);
  assert.equal(foreign.statusCode, 403);
  const incomplete = response();
  await attest({ method: 'POST', headers: { origin: 'https://kitty.grasany.com' }, body: { adult: true, woman: false } }, incomplete);
  assert.equal(incomplete.statusCode, 400);
});
