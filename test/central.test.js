// Production-hardening behaviour of central/server.js, cli.js and backup.js (boots real processes on throwaway ports and DBs).
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
let port = 4600 + Math.floor(Math.random() * 200);
async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-')), db = path.join(dir, 'c.db'), p = port++;
  const proc = spawn(process.execPath, ['--no-warnings', path.join(root, 'central', 'server.js')], { env: { ...process.env, PORT: p, CENTRAL_DB: db, ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const post = (u, body, headers = {}) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { base, db, dir, post, stop: () => proc.kill() };
}
const reg = (s, n, headers) => s.post('/register', { email: `u${n}@t.co`, name: 'U' + n, password: 'password123' }, headers);
const cli = (s, ...a) => execFileSync(process.execPath, ['--no-warnings', path.join(root, 'central', 'cli.js'), ...a], { env: { ...process.env, CENTRAL_DB: s.db } }).toString();

test('GET /health answers and responses are never cacheable', async () => {
  const s = await boot(); try {
    const r = await fetch(s.base + '/health');
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } finally { s.stop(); }
});

test('NO_AUTO_OWNER: first registrant is a member; cli promotes and sets plans; changes are audited', async () => {
  const s = await boot({ NO_AUTO_OWNER: '1' }); try {
    const j = await (await reg(s, 1)).json();
    assert.equal(j.user.role, 'member');
    assert.match(cli(s, 'list'), /member\s+free\s+u1@t\.co/);
    assert.match(cli(s, 'promote', 'u1@t.co', 'owner'), /member -> owner/);
    assert.match(cli(s, 'plan', 'U1@T.CO', 'pro'), /free -> pro/);
    const me = await (await fetch(s.base + '/me', { headers: { authorization: 'Bearer ' + j.token } })).json();
    assert.equal(me.user.role, 'owner'); assert.equal(me.user.plan, 'pro');
    assert.throws(() => cli(s, 'promote', 'nobody@t.co', 'owner'));
    assert.throws(() => cli(s, 'promote', 'u1@t.co', 'god'));
    const audit = new DatabaseSync(s.db).prepare("SELECT action FROM audit WHERE actor = 'cli'").all().map(r => r.action);
    assert.deepEqual(audit, ['cli.role', 'cli.plan']);
  } finally { s.stop(); }
});

test('without NO_AUTO_OWNER the first registrant is still the owner (development default)', async () => {
  const s = await boot(); try { assert.equal((await (await reg(s, 1)).json()).user.role, 'owner'); } finally { s.stop(); }
});

test('TRUST_PROXY=1: login lockout is per real client IP, not per proxy', async () => {
  const s = await boot({ TRUST_PROXY: '1' }); try {
    await reg(s, 1);
    const bad = ip => s.post('/login', { email: 'u1@t.co', password: 'wrong' }, { 'cf-connecting-ip': ip });
    for (let i = 0; i < 5; i++) assert.equal((await bad('1.1.1.1')).status, 401);
    assert.equal((await bad('1.1.1.1')).status, 429);        // attacker is locked out
    assert.equal((await bad('2.2.2.2')).status, 401);        // a different client is not
  } finally { s.stop(); }
});

test('without TRUST_PROXY a spoofed client-IP header cannot dodge the lockout', async () => {
  const s = await boot(); try {
    await reg(s, 1);
    const bad = n => s.post('/login', { email: 'u1@t.co', password: 'wrong' }, { 'cf-connecting-ip': '9.9.9.' + n, 'x-forwarded-for': '8.8.8.' + n });
    for (let i = 0; i < 5; i++) assert.equal((await bad(i)).status, 401);
    assert.equal((await bad(99)).status, 429);
  } finally { s.stop(); }
});

test('signup throttle: 10 accounts per hour per client IP', async () => {
  const s = await boot({ TRUST_PROXY: '1' }); try {
    for (let i = 0; i < 10; i++) assert.equal((await reg(s, i, { 'cf-connecting-ip': '5.5.5.5' })).status, 200);
    assert.equal((await reg(s, 10, { 'cf-connecting-ip': '5.5.5.5' })).status, 429);
    assert.equal((await reg(s, 11, { 'cf-connecting-ip': '6.6.6.6' })).status, 200);
  } finally { s.stop(); }
});

test('backup.js writes a restorable copy and keeps only the 14 newest', async () => {
  const s = await boot(); try {
    await reg(s, 1);
    const dir = path.join(s.dir, 'bk'); fs.mkdirSync(dir);
    for (let d = 1; d <= 16; d++) fs.writeFileSync(path.join(dir, `central-2020-01-${String(d).padStart(2, '0')}.db`), 'old');
    const out = execFileSync(process.execPath, ['--no-warnings', path.join(root, 'central', 'backup.js'), dir], { env: { ...process.env, CENTRAL_DB: s.db } }).toString();
    assert.match(out, /backup: .*central-\d{4}-\d{2}-\d{2}\.db/);
    const files = fs.readdirSync(dir).sort(); assert.equal(files.length, 14);
    const today = files[files.length - 1];
    assert.equal(new DatabaseSync(path.join(dir, today)).prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  } finally { s.stop(); }
});
