// Studio API guard rails that need neither ffmpeg nor Whisper nor network: input validation for the newer endpoints.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
let port = 5600 + Math.floor(Math.random() * 200);

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')), c = port++, l = port++, procs = [];
  procs.push(spawn(process.execPath, ['--no-warnings', path.join(root, 'central', 'server.js')], { env: { ...process.env, PORT: c, CENTRAL_DB: path.join(dir, 'c.db') }, stdio: 'ignore' }));
  procs.push(spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: l, CENTRAL_URL: `http://127.0.0.1:${c}`, KLIP_DATA: dir }, stdio: 'ignore' }));
  const base = `http://127.0.0.1:${l}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  let cookie = ''; const call = async (m, p, b, raw) => { const r = await fetch(base + p, { method: m, headers: { cookie }, body: raw ? b : b === undefined ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
  await call('POST', '/auth/register', { email: 's@t.co', name: 'S', password: 'password123' });
  return { call, stop: () => procs.forEach(p => p.kill()) };
}

test('music, logo, presets, settings and re-render reject bad input', async () => {
  const s = await boot(); try {
    assert.equal((await s.call('POST', '/music?ext=exe&name=x', Buffer.from('x'), true)).s, 400, 'only audio extensions');
    assert.equal((await s.call('GET', '/music')).j.music.length, 0);
    assert.equal((await s.call('POST', '/logos', Buffer.from('not a png'), true)).s, 400, 'logo must be a PNG');
    assert.equal((await s.call('GET', '/wave/aaaaaaaaaaaa.png')).s, 404);
    assert.equal((await s.call('POST', '/history/nope/rerender', { aspect: '1:1' })).s, 404);
    assert.equal((await s.call('POST', '/transcript', { id: 'zzz' })).s, 400);
    assert.equal((await s.call('POST', '/transcript', { id: 'aaaaaaaaaaaa' })).s, 404);
    assert.equal((await s.call('POST', '/settings', { ytCookies: 'netscape' })).s, 400);
    assert.equal((await s.call('POST', '/settings', { ytCookies: 'firefox' })).s, 200);
    assert.equal((await s.call('GET', '/settings')).j.ytCookies, 'firefox');
    const p = await s.call('POST', '/presets', { name: 'Brand', cfg: { aspect: '9:16', language: 'id', logoOn: true, musicId: 'abcdefabcdef', musicVol: 30, musicDuck: false, evil: 'x' } });
    const c = p.j.presets[0].cfg; assert.deepEqual([c.language, c.logoOn, c.musicId, c.musicVol, c.musicDuck, c.evil], ['id', true, 'abcdefabcdef', 30, false, undefined]);
  } finally { s.stop(); }
});
