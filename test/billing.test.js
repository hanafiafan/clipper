// DOKU payments in central/server.js against a mock DOKU: checkout creation, notification verification, plan activation, expiry.
// The mock re-implements the documented signature scheme independently of central/doku.js, so a mistake there cannot hide itself.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), crypto = require('node:crypto'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CID = 'MCH-TEST-0001', SECRET = 'SK-test-secret', root = path.join(__dirname, '..');
let port = 5000 + Math.floor(Math.random() * 300);
const b64h = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64'), dig = b => crypto.createHash('sha256').update(b).digest('base64');
const sigOf = ({ id = CID, rid, ts, target, body, secret = SECRET }) => 'HMACSHA256=' + b64h(secret, [`Client-Id:${id}`, `Request-Id:${rid}`, `Request-Timestamp:${ts}`, `Request-Target:${target}`, ...(body != null ? ['Digest:' + dig(body)] : [])].join('\n'));

async function mockDoku() {
  const seen = [], statuses = {};
  const srv = http.createServer((q, s) => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => {
    const body = Buffer.concat(c), h = q.headers, post = q.method === 'POST';
    const ok = h['client-id'] === CID && h.signature === sigOf({ rid: h['request-id'], ts: h['request-timestamp'], target: q.url, body: post ? body : null });
    seen.push({ url: q.url, method: q.method, ok, body: post ? JSON.parse(body) : null, ts: h['request-timestamp'] });
    s.setHeader('content-type', 'application/json');
    if (!ok) { s.statusCode = 401; return s.end('{"error_messages":["bad signature"]}'); }
    if (post && q.url === '/checkout/v1/payment') { const j = JSON.parse(body); return s.end(JSON.stringify({ message: ['SUCCESS'], response: { order: { invoice_number: j.order.invoice_number }, payment: { url: 'https://sandbox.doku.com/checkout/link/' + j.order.invoice_number, token_id: 't', expired_date: '20300101000000' } } })); }
    const m = /^\/orders\/v1\/status\/(.+)$/.exec(q.url);
    if (m && statuses[decodeURIComponent(m[1])]) return s.end(JSON.stringify({ transaction: { status: statuses[decodeURIComponent(m[1])] } }));
    s.statusCode = 404; s.end('{}');
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { seen, statuses, base: 'http://127.0.0.1:' + srv.address().port, stop: () => srv.close() };
}

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-')), db = path.join(dir, 'c.db'), p = port++;
  const proc = spawn(process.execPath, ['--no-warnings', path.join(root, 'central', 'server.js')], { env: { ...process.env, PORT: p, CENTRAL_DB: db, ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const j = async (m, u, body, tok) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const notify = (payload, { target = '/billing/doku/notify', secret = SECRET, id = CID, tamper } = {}) => {
    const raw = Buffer.from(JSON.stringify(payload)), rid = crypto.randomUUID(), ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    return fetch(base + '/billing/doku/notify', { method: 'POST', headers: { 'content-type': 'application/json', 'client-id': id, 'request-id': rid, 'request-timestamp': ts, signature: sigOf({ rid, ts, target, body: raw, secret }) }, body: tamper ? Buffer.concat([raw, Buffer.from(' ')]) : raw });
  };
  return { base, db, j, notify, port: p, stop: () => proc.kill() };
}
const paid = (inv, amount, status = 'SUCCESS') => ({ order: { invoice_number: inv, amount }, transaction: { status, date: new Date().toISOString() }, service: { id: 'VIRTUAL_ACCOUNT' } });
const signup = async (s, n) => (await s.j('POST', '/register', { email: `b${n}@t.co`, name: 'Budi ' + n, password: 'password123' })).j.token;

test('billing is off without DOKU credentials', async () => {
  const s = await boot(); try {
    const t = await signup(s, 1);
    assert.equal((await s.j('GET', '/plans')).j.billing.enabled, false);
    assert.equal((await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' }, t)).status, 503);
  } finally { s.stop(); }
});

test('checkout -> signed DOKU request -> notification activates the plan once, extends on renewal, and rejects forgeries', async () => {
  const d = await mockDoku(), s = await boot({ DOKU_CLIENT_ID: CID, DOKU_SECRET_KEY: SECRET, PUBLIC_URL: 'https://clipper.example/api', DOKU_BASE: d.base });
  try {
    assert.equal((await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' })).status, 401);
    const t = await signup(s, 1), plans = (await s.j('GET', '/plans')).j;
    assert.equal(plans.billing.enabled, true); assert.equal(plans.plans.pro.price.year, 490000); assert.equal(plans.plans.enterprise.price.month, 499000);
    for (const bad of [{ plan: 'free', period: 'month' }, { plan: 'pro', period: 'week' }, { plan: 'gold', period: 'month' }]) assert.equal((await s.j('POST', '/billing/checkout', bad, t)).status, 400);

    const c1 = await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month', app_port: 3003 }, t);
    assert.equal(c1.status, 200); assert.match(c1.j.url, /^https:\/\/sandbox\.doku\.com\/checkout\/link\/HC-/);
    const call = d.seen.find(x => x.url === '/checkout/v1/payment'), inv = c1.j.invoice;
    assert.ok(call.ok, 'DOKU accepted our signature'); assert.match(call.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(call.body.order.amount, 49000); assert.equal(call.body.order.invoice_number, inv); assert.equal(call.body.order.currency, 'IDR');
    assert.equal(call.body.order.callback_url, `https://clipper.example/api/billing/return?inv=${inv}&p=3003`);
    assert.equal(call.body.customer.email, 'b1@t.co'); assert.ok(inv.length <= 30);
    assert.equal((await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' }, t)).j.reused, true, 'same open order is reused');
    assert.equal((await s.j('GET', '/billing/orders', null, t)).j.orders[0].status, 'pending');
    assert.equal((await s.j('GET', '/billing/status?inv=' + inv)).j.status, 'pending');

    // forgeries
    assert.equal((await fetch(s.base + '/billing/doku/notify', { method: 'POST', body: JSON.stringify(paid(inv, 49000)) })).status, 401, 'unsigned');
    assert.equal((await s.notify(paid(inv, 49000), { secret: 'wrong' })).status, 401, 'wrong secret');
    assert.equal((await s.notify(paid(inv, 49000), { tamper: true })).status, 401, 'body altered after signing');
    assert.equal((await s.notify(paid(inv, 49000), { target: '/something/else' })).status, 401, 'wrong request target');
    assert.equal((await s.notify(paid(inv, 49000), { id: 'MCH-OTHER' })).status, 401, 'wrong client id');
    assert.equal((await s.j('GET', '/me', null, t)).j.user.plan, 'free', 'nothing activated by forgeries');
    assert.equal((await s.notify(paid(inv, 1000))).status, 400, 'amount mismatch is refused');
    assert.equal((await s.j('GET', '/me', null, t)).j.user.plan, 'free');

    // real notification
    assert.equal((await s.notify(paid(inv, 49000))).status, 200);
    let me = (await s.j('GET', '/me', null, t)).j.user; assert.equal(me.plan, 'pro');
    const days = (new Date(me.planUntil) - Date.now()) / 864e5; assert.ok(days > 29.9 && days < 30.1, 'about 30 days: ' + days);
    assert.equal((await s.j('GET', '/billing/status?inv=' + inv)).j.status, 'paid');
    assert.equal((await s.notify(paid(inv, 49000))).status, 200); // DOKU retries must not stack time
    assert.equal((await s.j('GET', '/me', null, t)).j.user.planUntil, me.planUntil, 'replay is idempotent');

    // renewal through the proxy-prefixed path (Traefik strips /api, DOKU signs the public path)
    const c2 = await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'year' }, t); assert.equal(c2.j.reused, undefined);
    assert.equal((await s.notify(paid(c2.j.invoice, 490000), { target: '/api/billing/doku/notify' })).status, 200);
    const me2 = (await s.j('GET', '/me', null, t)).j.user, extra = (new Date(me2.planUntil) - new Date(me.planUntil)) / 864e5;
    assert.ok(Math.abs(extra - 365) < 0.01, 'year extends from the current end date: ' + extra);

    // failed / unknown / lower plan
    const c3 = await s.j('POST', '/billing/checkout', { plan: 'enterprise', period: 'month' }, t);
    assert.equal((await s.notify(paid(c3.j.invoice, 499000, 'FAILED'))).status, 200);
    assert.equal((await s.j('GET', '/billing/status?inv=' + c3.j.invoice)).j.status, 'failed'); assert.equal((await s.j('GET', '/me', null, t)).j.user.plan, 'pro');
    assert.equal((await s.notify(paid('HC-NOPE', 1))).status, 200, 'unknown invoice is acknowledged so DOKU stops retrying');
    const db = new DatabaseSync(s.db); db.prepare("UPDATE users SET plan = 'enterprise', plan_until = NULL").run();
    assert.equal((await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' }, t)).status, 400, 'cannot buy a lower plan');
    assert.equal((await s.j('POST', '/billing/checkout', { plan: 'enterprise', period: 'month' }, t)).status, 400, 'admin-set plan has no term to extend');
    const acts = db.prepare("SELECT action FROM audit WHERE actor = 'doku'").all().map(r => r.action);
    assert.ok(acts.includes('billing.paid') && acts.includes('billing.notify.rejected') && acts.includes('billing.amount_mismatch'));
  } finally { s.stop(); d.stop(); }
});

test('an order DOKU says is still pending is not activated; expired plans fall back to free', async () => {
  const d = await mockDoku(), s = await boot({ DOKU_CLIENT_ID: CID, DOKU_SECRET_KEY: SECRET, PUBLIC_URL: 'https://clipper.example/api', DOKU_BASE: d.base });
  try {
    const t = await signup(s, 2), c = await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' }, t);
    d.statuses[c.j.invoice] = 'PENDING';
    assert.equal((await s.notify(paid(c.j.invoice, 49000))).status, 409); assert.equal((await s.j('GET', '/me', null, t)).j.user.plan, 'free');
    d.statuses[c.j.invoice] = 'SUCCESS';
    assert.equal((await s.notify(paid(c.j.invoice, 49000))).status, 200); assert.equal((await s.j('GET', '/me', null, t)).j.user.plan, 'pro');
    const db = new DatabaseSync(s.db); db.prepare('UPDATE users SET plan_until = ?').run(new Date(Date.now() - 1000).toISOString());
    const me = (await s.j('GET', '/me', null, t)).j.user; assert.equal(me.plan, 'free'); assert.equal(me.planUntil, null); assert.equal(me.limits.clipsPerMonth, 10);
    assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'plan.expired'").get());
  } finally { s.stop(); d.stop(); }
});

test('credential mistakes from DOKU become actionable messages', () => {
  const { explain } = require('../central/doku');
  assert.match(explain(400, { error: { code: 'invalid_client_id', message: 'Invalid Client-Id' } }), /Client ID tidak dikenal.*Secret Key.*mode sandbox/);
  assert.match(explain(400, { error: { code: 'invalid_signature' } }), /Secret Key tidak cocok/);
  assert.match(explain(400, { error_messages: ['order.amount must greater than 0', 'x'] }), /order\.amount must greater than 0; x/);
  assert.match(explain(500, {}), /HTTP 500/);
});

test('return page and checkout failure from DOKU', async () => {
  const d = await mockDoku(), s = await boot({ DOKU_CLIENT_ID: CID, DOKU_SECRET_KEY: 'SK-not-what-the-mock-expects', PUBLIC_URL: 'https://clipper.example/api', DOKU_BASE: d.base });
  try {
    const page = await fetch(s.base + '/billing/return?inv=HC-X&p=3003'); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    const t = await signup(s, 3), r = await s.j('POST', '/billing/checkout', { plan: 'pro', period: 'month' }, t);
    assert.equal(r.status, 424); assert.match(r.j.error, /DOKU: (Client ID|tanda tangan)|DOKU menolak/);
    assert.equal((await s.j('GET', '/billing/orders', null, t)).j.orders[0].status, 'failed');
  } finally { s.stop(); d.stop(); }
});
