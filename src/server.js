import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = join(root, 'data', 'kitty.json');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const demo = process.env.KITTY_LOCAL_DEMO === '1' && process.env.VERCEL !== '1';
const hostedPreview = process.env.KITTY_HOSTED_PREVIEW === '1' && !demo;
let state;
let transaction = Promise.resolve();

try { state = JSON.parse(await readFile(dataFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = core.initialState(); }

async function save(next) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(temp, dataFile);
}
function mutate(fn) {
  const job = transaction.then(async () => {
    const next = structuredClone(state);
    const result = fn(next);
    await save(next);
    state = next;
    return result;
  });
  transaction = job.catch(() => {});
  return job;
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
async function body(req) {
  let chunks = [], bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) throw new core.KittyError('body_too_large', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new core.KittyError('invalid_json'); }
}
function actor(req) {
  if (!demo) throw new core.KittyError('identity_unconfigured', 503);
  const userId = req.headers['x-demo-user'];
  if (typeof userId !== 'string' || !state.users.some(x => x.id === userId && !x.deletedAt)) throw new core.KittyError('demo_user_required', 401);
  return userId;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}:${port}`) throw new core.KittyError('origin_denied', 403);
}
function safeUser(x) { return { id: x.id, name: x.name, selfAttestedWoman: x.selfAttestedWoman, interests: x.interests }; }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { mode: demo ? 'local_synthetic_demo' : hostedPreview ? 'hosted_preview' : 'unconfigured', sso: false, verification: false, payments: false, price: { amountPaise: 69900, currency: 'INR', schedule: 'one_time', access: 'lifetime_after_activation' } });
    if (url.pathname.startsWith('/api/')) {
      sameOrigin(req);
      if (!demo) throw new core.KittyError('service_unconfigured', 503);
      if (req.method === 'GET' && url.pathname === '/api/demo-users') return json(res, 200, { users: state.users.filter(x => !x.deletedAt).map(safeUser) });
      if (req.method === 'POST' && url.pathname === '/api/demo-users') {
        const input = await body(req);
        return json(res, 201, { user: safeUser(await mutate(s => core.createUser(s, input))) });
      }
      const userId = actor(req);
      if (req.method === 'GET' && url.pathname === '/api/me') { const own = state.users.find(x => x.id === userId); return json(res, 200, { user: { ...safeUser(own), identityStatus: own.identityStatus, profile: own.profile }, memberships: state.memberships.filter(x => x.userId === userId && x.status === 'active').map(x => ({ ...x, group: state.groups.find(g => g.id === x.groupId)?.title })) }); }
      if (req.method === 'GET' && url.pathname === '/api/discovery') return json(res, 200, { groups: core.discovery(state, userId) });
      if (req.method === 'GET' && url.pathname === '/api/open-sessions') return json(res, 200, { sessions: core.openSessions(state, userId) });
      if (req.method === 'POST' && url.pathname === '/api/suggest-session') return json(res, 200, { suggestion: core.suggestOpenSession(state, userId) });
      if (req.method === 'GET' && url.pathname === '/api/invitations') return json(res, 200, { invitations: state.invitations.filter(x => x.targetId === userId && x.status === 'pending').map(x => ({ ...x, groupTitle: state.groups.find(g => g.id === x.groupId)?.title })) });
      if (req.method === 'GET' && url.pathname === '/api/export') return json(res, 200, core.exportOwnData(state, userId));
      if (req.method === 'GET' && url.pathname.startsWith('/api/groups/')) return json(res, 200, { group: core.groupView(state, userId, url.pathname.split('/')[3]) });
      if (req.method !== 'POST') throw new core.KittyError('route_not_found', 404);
      const input = await body(req);
      const routes = {
        '/api/groups': s => core.createGroup(s, userId, input),
        '/api/join': s => core.requestJoin(s, userId, input.groupId, input.shareProfile),
        '/api/request/decide': s => core.decideRequest(s, userId, input.requestId, input.decision),
        '/api/request/override': s => core.overrideRejection(s, userId, input.requestId, input.reason),
        '/api/profile': s => core.updateProfile(s, userId, input),
        '/api/invite': s => core.invite(s, userId, input.groupId, input.targetId),
        '/api/invite/accept': s => core.acceptInvite(s, userId, input.invitationId),
        '/api/group/leave': s => core.leaveGroup(s, userId, input.groupId),
        '/api/group/rotate-host': s => core.rotateHost(s, userId, input.groupId, input.targetId),
        '/api/events': s => core.createEvent(s, userId, input.groupId, input),
        '/api/events/update': s => core.updateEvent(s, userId, input.eventId, input),
        '/api/events/complete': s => core.completeEvent(s, userId, input.eventId),
        '/api/events/cancel': s => core.cancelEvent(s, userId, input.eventId, input.reason),
        '/api/cycle/exception': s => core.cycleException(s, userId, input.groupId, input.targetId, input.reason),
        '/api/cycle/complete': s => core.completeCycle(s, userId, input.groupId),
        '/api/rsvp': s => core.rsvp(s, userId, input.eventId, input.response),
        '/api/contributions': s => core.recordContribution(s, userId, input.groupId, input),
        '/api/expenses': s => core.createExpense(s, userId, input.groupId, input),
        '/api/expenses/approve': s => core.approveExpense(s, userId, input.expenseId),
        '/api/settlements': s => core.recordSettlement(s, userId, input.groupId, input),
        '/api/settlements/confirm': s => core.confirmSettlement(s, userId, input.settlementId),
        '/api/report': s => core.reportUser(s, userId, input.targetId, input.groupId, input.reason),
        '/api/block': s => core.blockUser(s, userId, input.targetId),
        '/api/contact': s => core.setContact(s, userId, input.value, input.consent),
        '/api/account/delete': s => core.deleteOwnAccount(s, userId)
      };
      if (!routes[url.pathname]) throw new core.KittyError('route_not_found', 404);
      const result = await mutate(routes[url.pathname]);
      return json(res, 200, { result });
    }
    if (req.method !== 'GET') throw new core.KittyError('route_not_found', 404);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'app.js', 'cat.js', 'style.css', 'motion.css', 'discovery.css', 'ux.css', 'editorial.css', 'kitty-mark.svg', 'kitty-editorial.webp', 'kitty-looks.webp'].includes(file)) throw new core.KittyError('route_not_found', 404);
    const content = await readFile(join(root, 'public', file));
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'", 'x-content-type-options': 'nosniff' });
    res.end(content);
  } catch (error) {
    json(res, error.status || 500, { error: error instanceof core.KittyError ? error.code : 'internal_error' });
  }
});

server.listen(port, host, () => console.log(`Kitty local demo: http://${host}:${port} (synthetic mode ${demo ? 'on' : 'off'})`));
