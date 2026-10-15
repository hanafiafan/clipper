// node --test test/updater.test.js: version logic, release parsing, checksum-verified download, and (macOS only) the app swap script.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto'), { execFileSync, spawn } = require('child_process');
const U = require('../lib/updater');

test('isNewer compares MAJOR.MINOR.PATCH numerically', () => {
  assert.ok(U.isNewer('1.0.10', '1.0.9')); assert.ok(U.isNewer('v2.0.0', '1.99.99')); assert.ok(U.isNewer('1.1.0', '1.0.9'));
  assert.ok(!U.isNewer('1.0.3', '1.0.3')); assert.ok(!U.isNewer('1.0.2', '1.0.3')); assert.ok(!U.isNewer('', '1.0.0'));
});

test('parseSums reads sha256sum and shasum output', () => {
  const h = 'a'.repeat(64), g = 'B'.repeat(64);
  assert.deepEqual(U.parseSums(`${h}  one.dmg\n${g} *two file.exe\nnot a line\n`), { 'one.dmg': h, 'two file.exe': g.toLowerCase() });
});

const rel = { tag_name: 'v1.2.0', body: '## Baru\n- **Fitur** [satu](http://x)\n', html_url: 'https://github.com/o/r/releases/tag/v1.2.0', draft: false, prerelease: false, assets: [
  { name: 'Hellens-Clipper-macOS-arm64.dmg', browser_download_url: 'https://github.com/o/r/releases/download/v1.2.0/Hellens-Clipper-macOS-arm64.dmg', size: 5 },
  { name: 'Hellens-Clipper-Windows-x64-Setup.exe', browser_download_url: 'https://github.com/o/r/releases/download/v1.2.0/Hellens-Clipper-Windows-x64-Setup.exe', size: 6 },
  { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/o/r/releases/download/v1.2.0/SHA256SUMS.txt' }] };

test('pickRelease chooses the platform asset and cleans the notes', () => {
  const m = U.pickRelease(rel, 'darwin', 'arm64'), w = U.pickRelease(rel, 'win32', 'x64');
  assert.equal(m.version, '1.2.0'); assert.equal(m.asset.name, 'Hellens-Clipper-macOS-arm64.dmg'); assert.equal(w.asset.name, 'Hellens-Clipper-Windows-x64-Setup.exe');
  assert.match(m.sums, /SHA256SUMS\.txt$/); assert.equal(m.notes, 'Baru\n- Fitur satu');
  assert.equal(U.pickRelease(rel, 'darwin', 'x64').asset, null, 'Intel Mac has no build');
  assert.equal(U.pickRelease(rel, 'linux', 'x64').asset, null);
  assert.equal(U.pickRelease({ ...rel, draft: true }), null); assert.equal(U.pickRelease({ ...rel, prerelease: true }), null); assert.equal(U.pickRelease({}), null);
});

test('fetchVerified accepts a matching checksum and rejects a wrong or missing one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')), body = crypto.randomBytes(200000), good = crypto.createHash('sha256').update(body).digest('hex');
  let sums = `${good}  Hellens-Clipper-macOS-arm64.dmg\n`;
  const srv = http.createServer((q, s) => { if (q.url === '/sums') s.end(sums); else s.end(body); }); await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port, r = { sums: base + '/sums', asset: { name: 'Hellens-Clipper-macOS-arm64.dmg', url: base + '/f' } };
  try {
    const seen = []; const f = path.join(dir, 'ok.dmg');
    await U.fetchVerified(r, f, { onProgress: p => seen.push(p) }); assert.ok(fs.readFileSync(f).equals(body)); assert.ok(seen.length && seen.at(-1) > 0.99);
    sums = `${'0'.repeat(64)}  Hellens-Clipper-macOS-arm64.dmg\n`; const bad = path.join(dir, 'bad.dmg');
    await assert.rejects(U.fetchVerified(r, bad), /Checksum tidak cocok/); assert.ok(!fs.existsSync(bad), 'a mismatching download is deleted');
    sums = `${good}  other.dmg\n`; await assert.rejects(U.fetchVerified(r, path.join(dir, 'x.dmg')), /Checksum rilis tidak ditemukan/);
  } finally { srv.close(); }
});

test('mac swap script replaces the app, cleans up, and leaves the old app on failure', { skip: process.platform !== 'darwin' && 'hdiutil is macOS only' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-')), apps = path.join(dir, 'Applications'), src = path.join(dir, 'src'), mk = (root, v) => { fs.mkdirSync(path.join(root, 'Hellens Clipper.app/Contents'), { recursive: true }); fs.writeFileSync(path.join(root, 'Hellens Clipper.app/Contents/v'), v); };
  mk(apps, 'old'); mk(src, 'new'); const dest = path.join(apps, 'Hellens Clipper.app'), dmg = path.join(dir, 'u.dmg');
  execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', 'HC', '-format', 'UDZO', dmg]);
  U.configure({ dir: path.join(dir, 'upd') });
  const waitFor = async (re, ms = 30000) => { const log = path.join(dir, 'upd/update.log'), t = Date.now(); while (Date.now() - t < ms) { if (fs.existsSync(log) && re.test(fs.readFileSync(log, 'utf8'))) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('timeout waiting for ' + re + '\n' + (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : 'no log')); };
  // bad dmg: the old app must survive untouched
  const junk = path.join(dir, 'junk.dmg'); fs.writeFileSync(junk, 'not a dmg');
  U.applyMac({ pid: 999999, dmg: junk, dest, noOpen: true }); await waitFor(/cannot mount dmg/);
  assert.equal(fs.readFileSync(path.join(dest, 'Contents/v'), 'utf8'), 'old');
  // good dmg, started while the "app" (a sleeping process) is still running: the swap must wait for it to exit
  const app = spawn('sleep', ['2']); U.applyMac({ pid: app.pid, dmg, dest, noOpen: true });
  await new Promise(r => setTimeout(r, 800)); assert.equal(fs.readFileSync(path.join(dest, 'Contents/v'), 'utf8'), 'old', 'waits for the app to quit');
  await waitFor(/^updated$/m);
  assert.equal(fs.readFileSync(path.join(dest, 'Contents/v'), 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(apps), ['Hellens Clipper.app'], 'no .old or staging leftovers'); assert.ok(!fs.existsSync(dmg), 'downloaded dmg removed');
});
