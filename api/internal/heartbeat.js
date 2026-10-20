import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { withKittyDatabase } from '../../lib/db.js';

const productId = 'kitty';
const path = '/api/internal/heartbeat';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex = /^[0-9a-f]{64}$/;

export function validHeartbeatSignature(headers, body, secret, now = Date.now()) {
  const product = headers.get('x-grasany-product');
  const timestamp = headers.get('x-grasany-timestamp');
  const nonce = headers.get('x-grasany-nonce');
  const signature = headers.get('x-grasany-signature');
  if (!secret || secret.length < 32 || product !== productId || !/^\d{13}$/.test(timestamp || '') || !uuid.test(nonce || '') || !hex.test(signature || '')) return false;
  if (Math.abs(now - Number(timestamp)) > 300000) return false;
  const digest = createHash('sha256').update(body).digest('hex');
  const canonical = `v1\n${productId}\nPOST\n${path}\n${timestamp}\n${nonce}\n${digest}`;
  const expected = createHmac('sha256', secret).update(canonical).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const size = Number(request.headers.get('content-length') || 0);
    if (size > 1024) return json({ error: 'denied' }, 403);
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 1024 || !validHeartbeatSignature(request.headers, raw, process.env.KITTY_HEARTBEAT_KEY)) return json({ error: 'denied' }, 403);
    let probeId;
    try {
      const input = JSON.parse(raw.toString('utf8'));
      if (!input || Object.keys(input).length !== 1 || !uuid.test(input.probeId || '')) throw new Error('invalid_body');
      probeId = input.probeId.toLowerCase();
    } catch { return json({ error: 'invalid_body' }, 400); }
    const started = Date.now();
    const nonce = request.headers.get('x-grasany-nonce');
    const stages = { readBefore: 'skipped', write: 'skipped', readAfter: 'skipped' };
    try {
      const state = await withKittyDatabase(async client => {
        await client.query('begin');
        try {
          await client.query("set local lock_timeout = '2s'");
          await client.query("delete from grasany_ops.heartbeat_nonce where nonce in (select nonce from grasany_ops.heartbeat_nonce where expires_at < now() limit 200)");
          const count = await client.query('select count(*)::int as n from grasany_ops.heartbeat_nonce');
          if (count.rows[0].n >= 10000) throw new Error('nonce_limit');
          const replay = await client.query("insert into grasany_ops.heartbeat_nonce(nonce, expires_at) values($1, now() + interval '10 minutes') on conflict do nothing returning nonce", [nonce]);
          if (!replay.rowCount) throw new Error('replayed');
          const before = await client.query("select counter, last_checked_at from grasany_ops.heartbeat where product_id = 'kitty' for update");
          if (!before.rowCount) throw new Error('missing_heartbeat');
          stages.readBefore = 'ok';
          if (before.rows[0].last_checked_at && Date.now() - new Date(before.rows[0].last_checked_at).getTime() < 60000) {
            await client.query('rollback');
            return { limited: true };
          }
          const next = Number(before.rows[0].counter) + 1;
          await client.query("update grasany_ops.heartbeat set counter = $1, last_probe_id = $2, last_checked_at = now() where product_id = 'kitty'", [next, probeId]);
          stages.write = 'ok';
          const after = await client.query("select counter, last_probe_id, last_checked_at from grasany_ops.heartbeat where product_id = 'kitty'");
          if (Number(after.rows[0]?.counter) !== next || after.rows[0]?.last_probe_id !== probeId) throw new Error('readback_failed');
          stages.readAfter = 'ok';
          await client.query('commit');
          return { checkedAt: after.rows[0].last_checked_at };
        } catch (error) {
          await client.query('rollback').catch(() => {});
          throw error;
        }
      });
      if (state.limited) return json({ version: 1, productId, probeId, status: 'rate_limited', checkedAt: null, durationMs: Date.now() - started, stages: { readBefore: 'ok', write: 'skipped', readAfter: 'skipped' } }, 429);
      return json({ version: 1, productId, probeId, status: 'ok', checkedAt: new Date(state.checkedAt).toISOString(), durationMs: Date.now() - started, stages });
    } catch {
      if (stages.readBefore === 'skipped') stages.readBefore = 'failed';
      else if (stages.write === 'skipped') stages.write = 'failed';
      else if (stages.readAfter === 'skipped') stages.readAfter = 'failed';
      return json({ version: 1, productId, probeId, status: 'error', checkedAt: null, durationMs: Date.now() - started, stages }, 503);
    }
  },
};
