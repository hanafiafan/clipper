// yt-dlp management. YouTube changes often and an old yt-dlp is answered with HTTP 403, so the app keeps its own up-to-date copy in the data
// folder (downloaded from the official release, checked against SHA2-256SUMS, ad-hoc signed on macOS) and falls back to the bundled / PATH one.
// It also finds a JavaScript runtime (deno or node >= 22; GUI apps start with a minimal PATH) and can borrow the browser's cookies.
// Zero dependencies. Environment (testing): YTDLP_FEED (URL of a "latest release" JSON), YTDLP_REPO.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { execFile, execFileSync } = require('child_process');

const FEED = () => process.env.YTDLP_FEED || `https://api.github.com/repos/${process.env.YTDLP_REPO || 'yt-dlp/yt-dlp'}/releases/latest`;
const exe = process.platform === 'win32' ? '.exe' : '';
const ASSET = { darwin: 'yt-dlp_macos', win32: 'yt-dlp.exe', linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux' }[process.platform];
let cfg = { dir: path.join(os.tmpdir(), 'hellens-ytdlp'), cookies: 'none' }, last = { check: 0, update: 0 }, updating = null;

const configure = o => { cfg = { ...cfg, ...o }; try { fs.mkdirSync(cfg.dir, { recursive: true }); } catch { /* read-only: the bundled copy keeps working */ } };
const local = () => path.join(cfg.dir, 'yt-dlp' + exe);
// The managed copy when it is present and runnable, else whatever the PATH provides (the bundled binary in a packaged app).
const bin = () => { try { fs.accessSync(local(), fs.constants.X_OK); return local(); } catch { return 'yt-dlp'; } };

// Directories where a user-installed deno / node usually lives; a Finder-launched app does not see them in PATH.
const EXTRA_PATHS = () => process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.homebrew/bin'), path.join(os.homedir(), '.deno/bin'), path.join(os.homedir(), '.bun/bin'), path.join(os.homedir(), '.local/bin')];
const augmentPath = () => { const have = (process.env.PATH || '').split(path.delimiter); process.env.PATH = [...have, ...EXTRA_PATHS().filter(d => !have.includes(d) && fs.existsSync(d))].join(path.delimiter); };
const which = name => { for (const d of (process.env.PATH || '').split(path.delimiter)) { const f = path.join(d, name + exe); try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ } } return null; };
// Flags that let yt-dlp solve YouTube's JS challenges: deno is picked up by default; node only counts from version 22 (Electron's embedded node 20 does not).
function jsArgs() {
  if (which('deno')) return [];
  const node = which('node');
  if (node) { try { if (parseInt(execFileSync(node, ['-v'], { timeout: 4000 }).toString().slice(1), 10) >= 22) return ['--js-runtimes', 'node:' + node]; } catch { /* unusable */ } }
  return [];
}
const COOKIE_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'brave', 'chromium', 'opera', 'vivaldi'];
const extraArgs = () => [...jsArgs(), ...(COOKIE_BROWSERS.includes(cfg.cookies) ? ['--cookies-from-browser', cfg.cookies] : [])];

const sh = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { timeout: 15000 }, (e, out) => e ? no(e) : ok(String(out).trim())));
const version = async () => { try { return await sh(bin(), ['--version']); } catch { return null; } };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };   // yt-dlp: YYYY.MM.DD
const parseSums = t => Object.fromEntries(String(t || '').split('\n').map(l => /^([a-f0-9]{64})\s+\*?(\S+)/i.exec(l)).filter(Boolean).map(m => [m[2], m[1].toLowerCase()]));

// Download the latest release if it is newer than what runs now. force: skip the "checked recently" guard (used after a failed download).
async function update({ force = false } = {}) {
  if (updating) return updating;
  if (!force && Date.now() - last.check < 3 * 864e5) return { updated: false, reason: 'recent' };
  if (force && Date.now() - last.update < 30 * 6e4) return { updated: false, reason: 'tried-recently' };
  updating = (async () => {
    last.check = Date.now(); if (force) last.update = Date.now();
    try {
      const rel = await (await fetch(FEED(), { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Hellens-Clipper' }, signal: AbortSignal.timeout(15000) })).json();
      const want = String(rel.tag_name || '').replace(/^v/, ''), cur = await version();
      if (!want || !ASSET) return { updated: false, reason: 'no-release' };
      if (cur && !newer(want, cur)) return { updated: false, reason: 'current', version: cur };
      const asset = (rel.assets || []).find(a => a.name === ASSET), sums = (rel.assets || []).find(a => a.name === 'SHA2-256SUMS');
      if (!asset || !sums) return { updated: false, reason: 'no-asset' };
      const wantSum = parseSums(await (await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(15000) })).text())[ASSET];
      if (!wantSum) return { updated: false, reason: 'no-checksum' };
      const r = await fetch(asset.browser_download_url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (crypto.createHash('sha256').update(buf).digest('hex') !== wantSum) throw new Error('checksum mismatch');
      const tmp = local() + '.new'; fs.writeFileSync(tmp, buf, { mode: 0o755 });
      if (process.platform === 'darwin') { try { execFileSync('codesign', ['--force', '--sign', '-', tmp], { stdio: 'ignore' }); } catch { /* the release binary is usually signed already */ } }
      const got = await sh(tmp, ['--version']).catch(() => null);                      // never swap in a binary that does not run
      if (!got) { fs.rmSync(tmp, { force: true }); throw new Error('downloaded binary does not run'); }
      fs.renameSync(tmp, local());
      return { updated: true, from: cur, version: got };
    } catch (e) { return { updated: false, reason: 'error', error: e.message }; }
    finally { updating = null; }
  })();
  return updating;
}

// Plain-language explanation for the errors people actually hit.
function explain(msg) {
  const m = String(msg || '');
  if (/video unavailable|This video is unavailable|has been removed|Private video/i.test(m)) return 'Video tidak tersedia: dihapus, privat, atau dibatasi di wilayahmu.';
  if (/Sign in to confirm|not a bot|age.restricted|confirm your age/i.test(m)) return 'YouTube meminta verifikasi login. Buka Pengaturan > Cookies browser dan pilih browser tempat kamu sudah login YouTube.';
  if (/JS runtime|JavaScript runtime|n challenge|player response|HTTP Error 403|Forbidden/i.test(m)) return 'YouTube menolak unduhan (403). Aplikasi sudah mencoba memperbarui mesin unduh; coba lagi sebentar lagi. Bila terus gagal, pasang Deno (brew install deno) atau pilih Cookies browser di Pengaturan.';
  if (/HTTP Error 404|Unable to download webpage/i.test(m)) return 'Halaman video tidak ditemukan (404). Periksa link-nya.';
  if (/Unsupported URL/i.test(m)) return 'Link tidak didukung. Tempel link video YouTube.';
  if (/Temporary failure|getaddrinfo|Network is unreachable|timed out/i.test(m)) return 'Tidak ada koneksi internet atau YouTube tidak terjangkau.';
  return m.replace(/^ERROR:\s*/, '').trim().slice(-300);
}
const retryable = msg => /HTTP Error 403|Forbidden|JS runtime|JavaScript runtime|n challenge|player response|Sign in to confirm|unable to download video data|Requested format is not available/i.test(String(msg || ''));

module.exports = { configure, bin, extraArgs, augmentPath, update, version, explain, retryable, jsArgs, which, newer, parseSums, COOKIE_BROWSERS, local, ASSET };
