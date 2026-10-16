// node --test test/ytdlp.test.js: yt-dlp self-update (checksum verified, never swaps in a broken binary), error explanations, version logic.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const fresh = () => { delete require.cache[require.resolve('../lib/ytdlp')]; return require('../lib/ytdlp'); };

test('version comparison and checksum parsing', () => {
  const Y = fresh();
  assert.ok(Y.newer('2026.08.19', '2026.03.17')); assert.ok(Y.newer('2026.10.01', '2026.09.30')); assert.ok(!Y.newer('2026.03.17', '2026.03.17')); assert.ok(!Y.newer('2025.12.31', '2026.01.01'));
  const h = 'a'.repeat(64); assert.deepEqual(Y.parseSums(`${h}  yt-dlp_macos\n${h} *yt-dlp.exe\nx`), { 'yt-dlp_macos': h, 'yt-dlp.exe': h });
});

test('errors are explained and only YouTube-style failures are retried', () => {
  const Y = fresh();
  assert.match(Y.explain('ERROR: [youtube] x: This video is unavailable'), /tidak tersedia/);
  assert.match(Y.explain("ERROR: Sign in to confirm you're not a bot"), /Cookies browser/);
  assert.match(Y.explain('ERROR: unable to download video data: HTTP Error 403: Forbidden'), /403/);
  assert.match(Y.explain('ERROR: Unsupported URL: https://x'), /tidak didukung/);
  assert.match(Y.explain('ERROR: [generic] x: Unable to download webpage: HTTP Error 404: Not Found'), /404/);
  assert.equal(Y.explain('ERROR: some other failure'), 'some other failure');
  assert.ok(Y.retryable('HTTP Error 403: Forbidden')); assert.ok(Y.retryable('No supported JavaScript runtime')); assert.ok(!Y.retryable('This video is unavailable'));
});

async function feed(version, { goodSum = true, script, dir: useDir } = {}) {
  const Y = fresh(), body = Buffer.from(script || `#!/bin/sh\necho ${version}\n`), sum = goodSum ? crypto.createHash('sha256').update(body).digest('hex') : '0'.repeat(64);
  const srv = http.createServer((q, s) => { if (q.url === '/rel') { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ tag_name: version, assets: [
    { name: Y.ASSET, browser_download_url: `http://127.0.0.1:${srv.address().port}/bin` }, { name: 'SHA2-256SUMS', browser_download_url: `http://127.0.0.1:${srv.address().port}/sums` }] })); }
    else if (q.url === '/sums') s.end(`${sum}  ${Y.ASSET}\n`); else s.end(body); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.YTDLP_FEED = `http://127.0.0.1:${srv.address().port}/rel`;
  const dir = useDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-')); Y.configure({ dir });
  return { Y, dir, stop: () => { srv.close(); delete process.env.YTDLP_FEED; } };
}

test('update downloads the newer release, verifies it and makes it the binary in use', { skip: process.platform === 'win32' && 'shell-script fake binary' }, async () => {
  const f = await feed('2099.01.01'); try {
    assert.equal(f.Y.bin(), 'yt-dlp', 'nothing managed yet');
    const r = await f.Y.update({ force: true }); assert.equal(r.updated, true, JSON.stringify(r));
    assert.equal(f.Y.bin(), f.Y.local()); assert.equal(await f.Y.version(), '2099.01.01');
    assert.deepEqual(fs.readdirSync(f.dir), ['yt-dlp'], 'no temp leftovers');
  } finally { f.stop(); }
});

test('a wrong checksum or a binary that does not run is never swapped in', { skip: process.platform === 'win32' && 'shell-script fake binary' }, async () => {
  let f = await feed('2099.01.01', { goodSum: false }); try {
    const r = await f.Y.update({ force: true }); assert.equal(r.updated, false); assert.match(r.error, /checksum/); assert.equal(f.Y.bin(), 'yt-dlp'); assert.deepEqual(fs.readdirSync(f.dir), []);
  } finally { f.stop(); }
  f = await feed('2099.01.01', { script: '#!/bin/sh\nexit 1\n' }); try {
    const r = await f.Y.update({ force: true }); assert.equal(r.updated, false); assert.match(r.error, /does not run/); assert.deepEqual(fs.readdirSync(f.dir), []);
  } finally { f.stop(); }
});

test('no download when the installed version is already current; forced retries are rate limited', { skip: process.platform === 'win32' && 'shell-script fake binary' }, async () => {
  const f = await feed('2099.01.01'); try {
    await f.Y.update({ force: true }); // now local = 2099.01.01
    const again = await f.Y.update({ force: true }); assert.equal(again.reason, 'tried-recently');
  } finally { f.stop(); }
  // an older release than the managed binary is ignored
  const h = await feed('2099.01.01'); await h.Y.update({ force: true }); h.stop();
  const g = await feed('2000.01.01', { dir: h.dir }); try {
    const r = await g.Y.update({ force: true }); assert.equal(r.updated, false); assert.equal(r.reason, 'current'); assert.equal(await g.Y.version(), '2099.01.01');
  } finally { g.stop(); }
});
