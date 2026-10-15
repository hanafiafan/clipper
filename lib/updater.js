// In-app updater. Every installed copy asks the same place (the latest GitHub release) whether a newer version exists,
// and can download, verify (SHA-256 from the release's SHA256SUMS.txt) and install it.
//   macOS:   a detached shell script waits for this app to exit, swaps /Applications/Hellens Clipper.app and reopens it.
//   Windows: the NSIS installer is started and this app exits (the installer replaces the app and starts it again).
// Zero dependencies. The app is not notarized, so Squirrel-style auto-update (electron-updater) is not an option; this follows
// the same trust model as landing/install.sh: download from the release, verify the checksum, copy into place.
// Environment (testing): UPDATE_REPO, UPDATE_FEED (full URL of a "latest release" JSON), NO_OPEN=1.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process'), { Readable } = require('stream');

const FEED = () => process.env.UPDATE_FEED || `https://api.github.com/repos/${process.env.UPDATE_REPO || 'hanafiafan/clipper'}/releases/latest`;
const TTL = 30 * 60e3;                                   // GitHub allows 60 anonymous calls/hour per IP; one per 30 min is far below
const ASSETS = { darwin: /^Hellens-Clipper-macOS-arm64\.dmg$/i, win32: /^Hellens-Clipper-Windows-x64-Setup\.exe$/i };

const nums = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
// true when version a is newer than b (plain MAJOR.MINOR.PATCH; GitHub's "latest" never returns prereleases)
const isNewer = (a, b) => { const x = nums(a), y = nums(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// "<sha256>  <name>" lines (also "<sha256> *<name>") -> { name: sha256 }
const parseSums = text => Object.fromEntries(String(text || '').split('\n').map(l => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(l)).filter(Boolean).map(m => [m[2], m[1].toLowerCase()]));

// Release notes come from markdown: keep readable plain lines, escape nothing (the UI escapes), cap the length.
const plainNotes = md => String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s*/gm, '').replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim().slice(0, 900);

// Reduce a GitHub "release" JSON to what the app needs for this platform.
function pickRelease(j, platform = process.platform, arch = process.arch) {
  if (!j || !j.tag_name || j.draft || j.prerelease) return null;
  const assets = Array.isArray(j.assets) ? j.assets : [], re = ASSETS[platform];
  const a = re && !(platform === 'darwin' && arch !== 'arm64') ? assets.find(x => re.test(x.name)) : null, sums = assets.find(x => x.name === 'SHA256SUMS.txt');
  return { version: String(j.tag_name).replace(/^v/i, ''), notes: plainNotes(j.body), page: j.html_url || null, date: j.published_at || null,
    asset: a ? { name: a.name, url: a.browser_download_url, size: a.size || 0 } : null, sums: sums ? sums.browser_download_url : null };
}

// ---------------------------------------------------------------------------------------------------------------- state
let cfg = { dir: path.join(require('os').tmpdir(), 'hellens-updates'), current: '0.0.0' }, cache = { at: 0, rel: null }, inflight = null;
let inst = { state: 'idle' };                              // idle | downloading | verifying | installing | error
const configure = o => { cfg = { ...cfg, ...o }; try { fs.mkdirSync(cfg.dir, { recursive: true }); for (const f of fs.readdirSync(cfg.dir)) if (Date.now() - fs.statSync(path.join(cfg.dir, f)).mtimeMs > 7 * 864e5) fs.rmSync(path.join(cfg.dir, f), { force: true }); } catch { /* best effort */ } };

const getJSON = async (url, ms = 10000) => {
  const r = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Hellens-Clipper/' + cfg.current }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
};

// Where this running app lives, if it is an installed copy we can replace (null in dev, or when the folder is not writable).
function installTarget() {
  if (!process.versions.electron) return null;
  if (process.platform === 'darwin') {
    const m = /^(.*\.app)\/Contents\/MacOS\//.exec(process.execPath); if (!m) return null;
    try { fs.accessSync(path.dirname(m[1]), fs.constants.W_OK); return m[1]; } catch { return null; }
  }
  return process.platform === 'win32' && /\.exe$/i.test(process.execPath) ? process.execPath : null;
}

const view = () => {
  const rel = cache.rel, available = !!rel && isNewer(rel.version, cfg.current);
  return { current: cfg.current, latest: rel ? rel.version : null, available, notes: available ? rel.notes : '', page: rel ? rel.page : null, date: rel ? rel.date : null,
    asset: available && rel.asset ? { name: rel.asset.name, size: rel.asset.size } : null,
    canInstall: available && !!rel.asset && !!rel.sums && !!installTarget(), install: inst, checkedAt: cache.at };
};

// Ask the feed (cached 30 min; network errors keep the last known answer so a flaky connection never breaks the UI).
async function check({ force } = {}) {
  if (!force && cache.rel && Date.now() - cache.at < TTL) return view();
  inflight = inflight || getJSON(FEED()).then(j => { cache = { at: Date.now(), rel: pickRelease(j) }; }).catch(() => { cache.at = Date.now() - TTL + 6e4; })   // failed: keep the last answer and retry in a minute.finally(() => { inflight = null; });
  await inflight; return view();
}

// ---------------------------------------------------------------------------------------------------------------- install
async function download(url, dest, onProgress) {
  const r = await fetch(url, { headers: { 'user-agent': 'Hellens-Clipper/' + cfg.current }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error('Unduhan gagal (HTTP ' + r.status + ')');
  const total = +r.headers.get('content-length') || 0, hash = crypto.createHash('sha256'), out = fs.createWriteStream(dest);
  let got = 0;
  try {
    for await (const chunk of Readable.fromWeb(r.body)) {
      hash.update(chunk); got += chunk.length; if (!out.write(chunk)) await new Promise(ok => out.once('drain', ok));
      onProgress(total ? got / total : 0);
    }
  } finally { await new Promise(ok => out.end(ok)); }
  return hash.digest('hex');
}

// Download rel.asset to `file` and check it against the release's SHA256SUMS.txt. A missing checksum is a refusal, not a pass.
async function fetchVerified(rel, file, { onProgress = () => {}, onVerify = () => {} } = {}) {
  const sums = parseSums(await (await fetch(rel.sums, { headers: { 'user-agent': 'Hellens-Clipper/' + cfg.current } })).text()), want = sums[rel.asset.name];
  if (!want) throw new Error('Checksum rilis tidak ditemukan; pembaruan dibatalkan.');
  const got = await download(rel.asset.url, file, onProgress); onVerify();
  if (got !== want) { fs.rmSync(file, { force: true }); throw new Error('Checksum tidak cocok; berkas unduhan dibuang.'); }
  return file;
}

// Shell script run (detached) after this app exits. args: PID DMG DEST LOGFILE
const MAC_SCRIPT = `#!/bin/bash
# Hellens Clipper updater (macOS). Written by lib/updater.js; swaps the installed app for the one inside the verified DMG.
PID="$1"; DMG="$2"; DEST="$3"; exec >>"$4" 2>&1
echo "== $(date) update start: $DMG -> $DEST"
for i in $(seq 1 80); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
kill -0 "$PID" 2>/dev/null && { echo "app still running, giving up"; exit 1; }
MNT="$(mktemp -d)"; APP="Hellens Clipper.app"; STAGE="$(dirname "$DEST")/.hellens-update.$$"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null; rm -rf "$STAGE" "$MNT"; }
trap cleanup EXIT
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" -quiet || { echo "cannot mount dmg"; exit 1; }
ditto "$MNT/$APP" "$STAGE" || { echo "copy failed"; exit 1; }
rm -rf "$DEST.old"
if mv "$DEST" "$DEST.old" 2>/dev/null || [ ! -e "$DEST" ]; then
  if mv "$STAGE" "$DEST"; then rm -rf "$DEST.old"; else echo "swap failed, restoring"; mv "$DEST.old" "$DEST"; exit 1; fi
else echo "cannot move old app"; exit 1; fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
rm -f "$DMG"
echo "updated"
[ "\${NO_OPEN:-}" = "1" ] || env -u ELECTRON_RUN_AS_NODE open "$DEST"
`;

function applyMac({ pid, dmg, dest, noOpen }) {
  const script = path.join(cfg.dir, 'apply-update.sh'); fs.writeFileSync(script, MAC_SCRIPT, { mode: 0o755 });
  const child = spawn('/bin/bash', [script, String(pid), dmg, dest, path.join(cfg.dir, 'update.log')], { detached: true, stdio: 'ignore', env: { ...process.env, NO_OPEN: noOpen ? '1' : '' } });
  child.unref(); return child;
}

// Start the update in the background. quit() is called once the replacement is queued. Returns the install state immediately.
async function install({ quit } = {}) {
  if (['downloading', 'verifying', 'installing'].includes(inst.state)) return inst;
  const v = await check({ force: true });
  if (!v.available) throw new Error('Sudah versi terbaru.');
  if (!v.canInstall) throw new Error('Pemasangan otomatis tidak tersedia di perangkat ini. Unduh manual dari halaman rilis.');
  const rel = cache.rel, dest = installTarget(), file = path.join(cfg.dir, rel.asset.name);
  const trusted = process.env.UPDATE_FEED || /^https:\/\/github\.com\//.test(rel.asset.url);       // a custom feed is the developer's own choice
  if (!trusted) throw new Error('Alamat unduhan tidak dipercaya.');
  inst = { state: 'downloading', pct: 0, version: rel.version };
  (async () => {
    try {
      await fetchVerified(rel, file, { onProgress: p => { inst.pct = Math.round(p * 100); }, onVerify: () => { inst.state = 'verifying'; } });
      inst = { state: 'installing', pct: 100, version: rel.version };
      if (process.platform === 'darwin') applyMac({ pid: process.pid, dmg: file, dest, noOpen: process.env.NO_OPEN === '1' });
      else spawn(file, [], { detached: true, stdio: 'ignore' }).unref();                                   // NSIS installer replaces the app and starts it again
      setTimeout(() => quit && quit(), 700);
    } catch (e) { inst = { state: 'error', error: e.message }; }
  })();
  return inst;
}

module.exports = { configure, check, install, isNewer, parseSums, pickRelease, plainNotes, applyMac, fetchVerified, installTarget, status: view, MAC_SCRIPT };
