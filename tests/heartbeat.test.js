import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import heartbeat, { validHeartbeatSignature } from '../api/internal/heartbeat.js';

test('heartbeat accepts only exact canonical HMAC and freshness', () => {
  const secret = 'kitty-test-key-with-more-than-32-characters';
  const body = Buffer.from(JSON.stringify({ probeId: randomUUID() }));
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const digest = createHash('sha256').update(body).digest('hex');
  const message = `v1\nkitty\nPOST\n/api/internal/heartbeat\n${timestamp}\n${nonce}\n${digest}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  const headers = new Headers({ 'x-grasany-product': 'kitty', 'x-grasany-timestamp': timestamp, 'x-grasany-nonce': nonce, 'x-grasany-signature': signature });
  assert.equal(validHeartbeatSignature(headers, body, secret), true);
  assert.equal(validHeartbeatSignature(headers, Buffer.from('{}'), secret), false);
  assert.equal(validHeartbeatSignature(headers, body, secret, Date.now() + 301000), false);
  headers.set('x-grasany-product', 'other');
  assert.equal(validHeartbeatSignature(headers, body, secret), false);
});

test('heartbeat denies unauthenticated requests without touching the database', async () => {
  const response = await heartbeat.fetch(new Request('https://kitty.grasany.com/api/internal/heartbeat', { method: 'POST', body: JSON.stringify({ probeId: randomUUID() }), headers: { 'content-type': 'application/json' } }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'denied' });
});
