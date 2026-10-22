import test from 'node:test';
import assert from 'node:assert/strict';
import start from '../api/auth/start.js';
import callback from '../api/auth/callback.js';
import session from '../api/auth/session.js';
import attest from '../api/account/attest.js';
import { authorizationScope, validAuthorizationTokens } from '../lib/auth.js';

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

test('authorization token response accepts absent unchanged scope and exact present scope', () => {
  const tokens = { access_token: 'access', id_token: 'id', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 };
  assert.equal(authorizationScope, 'openid email profile');
  assert.equal(validAuthorizationTokens(tokens), true);
  assert.equal(validAuthorizationTokens({ ...tokens, scope: 'profile openid email' }), true);
});

test('authorization token response rejects malformed or reduced scope and missing required fields', () => {
  const tokens = { access_token: 'access', id_token: 'id', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 };
  for (const scope of [undefined, null, '', 7, 'openid email', 'openid email profile extra', 'openid  email profile', 'openid email email']) {
    assert.equal(validAuthorizationTokens({ ...tokens, scope }), false);
  }
  for (const key of ['access_token', 'id_token', 'refresh_token', 'token_type', 'expires_in']) {
    const missing = { ...tokens };
    delete missing[key];
    assert.equal(validAuthorizationTokens(missing), false, key);
  }
  assert.equal(validAuthorizationTokens({ ...tokens, token_type: 'MAC' }), false);
  assert.equal(validAuthorizationTokens({ ...tokens, expires_in: 0 }), false);
});
