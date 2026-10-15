// Hellens Central: akun, sesi, role. Zero-dep (node:sqlite, node 22+). Video & render tetap di app lokal user.
// Jalankan: node central/server.js  (PORT=4000, CENTRAL_DB=path ke file sqlite)
const http = require('http'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const doku = require('./doku');
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';                 // di dalam container: 0.0.0.0
const TRUST_PROXY = process.env.TRUST_PROXY === '1';          // di belakang Traefik/Cloudflare: pakai IP klien asli dari header
const NO_AUTO_OWNER = process.env.NO_AUTO_OWNER === '1';      // produksi: pengguna pertama TIDAK otomatis owner (promosikan lewat central/cli.js)
const db = new DatabaseSync(process.env.CENTRAL_DB || path.join(__dirname, 'central.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
  CREATE TABLE IF NOT EXISTS content (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL,
    clips INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month));
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, invoice TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL, period TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', url TEXT, created_at TEXT NOT NULL, paid_at TEXT);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);`);

if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'plan_until')) db.exec('ALTER TABLE users ADD COLUMN plan_until TEXT'); // paid plans end here (ISO UTC); NULL = no expiry (set by an admin)

const SESSION_MS = 7 * 864e5;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const hashPw = pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => { const [s, h] = stored.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex')); };
// Definisi plan di kode (bukan DB): harga/limit berubah lewat deploy. null = tanpa batas.
const PLANS = {
  free:       { name: 'Free',       clipsPerMonth: 10,   maxResolution: '720p',  clipsPerJob: 3 },
  pro:        { name: 'Pro',        clipsPerMonth: 100,  maxResolution: '1080p', clipsPerJob: 6, price: { month: 49000, year: 490000 } },        // IDR; year = 10 months
  enterprise: { name: 'Enterprise', clipsPerMonth: null, maxResolution: '4k',    clipsPerJob: 6, price: { month: 499000, year: 4990000 } },
};
const RANK = { free: 0, pro: 1, enterprise: 2 }, PERIOD_DAYS = { month: 30, year: 365 }, PERIOD_LABEL = { month: 'bulanan', year: 'tahunan' };
// A paid plan that ran past plan_until drops back to free the next time the account is read.
function expireIfDue(u) {
  if (u && u.plan !== 'free' && u.plan_until && u.plan_until < new Date().toISOString()) {
    db.prepare("UPDATE users SET plan = 'free', plan_until = NULL WHERE id = ?").run(u.id); audit('system', 'plan.expired', u.email, `${u.plan} berakhir ${u.plan_until}`);
    return { ...u, plan: 'free', plan_until: null };
  }
  return u;
}
const audit = (actor, action, target, detail) => db.prepare('INSERT INTO audit (at,actor,action,target,detail) VALUES (?,?,?,?,?)').run(new Date().toISOString(), actor, action, target ?? null, detail ?? null);
const ROLES = ['owner', 'admin', 'member'];
// --- CMS: konten yang bisa diedit admin tanpa deploy. Default di kode; override disimpan di tabel content. ---
const HEX = /^#[0-9a-fA-F]{6}$/;
const CONTENT = {
  hook_styles: { // gaya badge hook di video: id -> {label,bg,color,rounded}
    default: { punch: { label: 'Punch', bg: '#FF542B', color: '#171916', rounded: false }, clean: { label: 'Clean', bg: '#F0F3ED', color: '#171916', rounded: true }, dark: { label: 'Dark', bg: '#171916', color: '#FFFFFF', rounded: false } },
    clean(v) {
      const e = Object.entries(v || {});
      if (!e.length || e.length > 10) throw new Error('Minimal 1, maksimal 10 gaya hook');
      return Object.fromEntries(e.map(([id, x]) => {
        if (!/^[a-z0-9-]{1,20}$/.test(id)) throw new Error('ID gaya hook: huruf kecil/angka/-, maks 20');
        if (!HEX.test(x?.bg) || !HEX.test(x?.color)) throw new Error(`Warna gaya "${id}" harus format #RRGGBB`);
        return [id, { label: String(x.label || id).trim().slice(0, 30), bg: x.bg, color: x.color, rounded: !!x.rounded }];
      }));
    } },
  caption_presets: { // warna highlight kata aktif per preset caption
    default: { karaoke: { hl: '#00FF66' }, beasty: { hl: '#FFB800' }, simple: { hl: '#FFD400' }, impact: { hl: '#FF542B' }, clean: { hl: '#FF542B' }, boxed: { hl: '#FF542B' } },
    clean(v) {
      return Object.fromEntries(Object.keys(this.default).map(id => {
        if (!HEX.test(v?.[id]?.hl)) throw new Error(`Warna highlight "${id}" harus format #RRGGBB`);
        return [id, { hl: v[id].hl }];
      }));
    } },
  plan_copy: { // teks tampilan kartu plan (limit sebenarnya ada di PLANS)
    default: { free: { price: 'Gratis', tagline: 'Untuk mencoba', features: ['Caption otomatis', 'Saran momen AI'] },
               pro: { price: 'Rp 49.000 / bulan', tagline: 'Untuk kreator aktif', features: ['Kuota lebih besar', 'Resolusi hingga 1080p'] },
               enterprise: { price: 'Rp 499.000 / bulan', tagline: 'Untuk tim & agensi', features: ['Tanpa batas klip', 'Resolusi hingga 4K', 'Dukungan prioritas'] } },
    clean(v) {
      return Object.fromEntries(Object.keys(PLANS).map(id => {
        const x = v?.[id], f = Array.isArray(x?.features) ? x.features.map(t => String(t).trim().slice(0, 80)).filter(Boolean) : null;
        if (!f || f.length > 8) throw new Error(`Fitur plan "${id}": 0-8 baris teks`);
        return [id, { price: String(x.price || '').trim().slice(0, 40), tagline: String(x.tagline || '').trim().slice(0, 60), features: f }];
      }));
    } },
};
const getContent = () => Object.fromEntries(Object.entries(CONTENT).map(([k, c]) => {
  const row = db.prepare('SELECT value FROM content WHERE key = ?').get(k);
  return [k, row ? JSON.parse(row.value) : c.default];
}));
const month = () => new Date().toISOString().slice(0, 7);
const used = id => db.prepare('SELECT clips FROM usage WHERE user_id = ? AND month = ?').get(id, month())?.clips || 0;
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, planUntil: u.plan_until || null, limits: PLANS[u.plan], usage: { month: month(), clips: used(u.id) } });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
// IP klien: header proxy hanya dipercaya bila TRUST_PROXY=1 (kalau tidak, siapa pun bisa memalsukannya).
const clientIp = req => (TRUST_PROXY && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress;
const raw = req => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > 2e5) { req.destroy(); no(new Error('terlalu besar')); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { no(new Error('JSON tidak valid')); } }); });

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
function userFor(req) { // token dikirim sebagai "Authorization: Bearer <token>"
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return null;
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  return expireIfDue(db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND u.disabled = 0').get(sha(t)) || null);
}

// ponytail: rate limit in-memory per IP+email; pindah ke tabel kalau pusat di-scale ke banyak proses.
const fails = new Map();
const blocked = k => (fails.get(k) || []).filter(t => Date.now() - t < 9e5).length >= 5;
// ponytail: pembatas pendaftaran in-memory per IP (10/jam); hilang saat restart, pindah ke tabel bila perlu.
const signups = new Map();
const signupBlocked = ip => { const l = (signups.get(ip) || []).filter(t => Date.now() - t < 36e5); signups.set(ip, l); return l.length >= 10; };
const fail = k => fails.set(k, [...(fails.get(k) || []).filter(t => Date.now() - t < 9e5), Date.now()]);

// ---------------------------------------------------------------------------------------------------------------- pembayaran
const invoiceId = () => 'HC-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();   // < 30 karakter (batas kartu kredit DOKU)
const orderView = o => ({ invoice: o.invoice, plan: o.plan, period: o.period, amount: o.amount, status: o.status, created_at: o.created_at, paid_at: o.paid_at, url: o.status === 'pending' ? o.url : null });
const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();
// Tandai pesanan lunas dan aktifkan plan: perpanjang dari plan_until bila plan yang sama masih aktif, jika tidak mulai dari sekarang. Idempoten.
function settle(order, via) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    if (o.status === 'paid') { db.exec('COMMIT'); return false; }
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id), now = new Date().toISOString();
    const base = u.plan === o.plan && u.plan_until && u.plan_until > now ? u.plan_until : now, until = addDays(base, PERIOD_DAYS[o.period]);
    db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now, o.id);
    db.prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?').run(o.plan, until, u.id);
    audit('doku', 'billing.paid', u.email, `${o.invoice} ${o.plan}/${o.period} Rp${o.amount} sampai ${until} (${via})`);
    db.exec('COMMIT'); return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
async function notify(req, res, p) {
  const rawBody = await raw(req), pathCandidates = [...new Set([p, '/api' + p, doku.cfg().notifyUrl && new URL(doku.cfg().notifyUrl).pathname].filter(Boolean))]; // di belakang Traefik prefix /api dilepas
  if (!doku.verifyNotification(req.headers, rawBody, pathCandidates)) { audit('doku', 'billing.notify.rejected', null, String(req.headers['request-id'] || '').slice(0, 64)); return json(res, 401, { error: 'tanda tangan tidak valid' }); }
  let j; try { j = JSON.parse(rawBody.toString('utf8')); } catch { return json(res, 400, { error: 'JSON tidak valid' }); }
  const inv = String(j.order && j.order.invoice_number || ''), st = String(j.transaction && j.transaction.status || '').toUpperCase();
  const order = db.prepare('SELECT * FROM orders WHERE invoice = ?').get(inv);
  if (!order) return json(res, 200, { ok: true, ignored: 'pesanan tidak dikenal' });                       // 200 supaya DOKU berhenti mengulang
  if (st === 'SUCCESS') {
    if (j.order.amount != null && Number(j.order.amount) !== order.amount) { audit('doku', 'billing.amount_mismatch', inv, `${j.order.amount} != ${order.amount}`); return json(res, 400, { error: 'nominal tidak cocok' }); }
    const confirm = await doku.statusOf(inv);                                                              // tanya DOKU langsung bila fiturnya aktif (null = tidak bisa dibaca)
    if (confirm && confirm !== 'SUCCESS') { audit('doku', 'billing.status_conflict', inv, confirm); return json(res, 409, { error: 'status di DOKU belum SUCCESS' }); }
    settle(order, 'notify');
  } else if (['FAILED', 'EXPIRED'].includes(st)) db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'").run(st.toLowerCase(), order.id);
  return json(res, 200, { ok: true });
}
const RETURN_PAGE = `<!doctype html><html lang=id><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Pembayaran · Hellens Clipper</title>
<style>:root{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#d8e5d4;color:#171916;font:16px/1.5 system-ui,sans-serif;padding:20px}
main{width:min(460px,100%);background:#e9eee6;border:2px solid #171916;box-shadow:8px 8px 0 #ff542b;padding:28px}h1{font:400 38px/1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;margin:0 0 10px}
p{margin:8px 0}.k{font:700 11px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#ff542b}a.b{display:inline-block;margin-top:14px;background:#171916;color:#e9eee6;padding:12px 18px;text-decoration:none;font:700 12px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
.bar{height:8px;border:1px solid #171916;margin-top:14px;overflow:hidden}.bar i{display:block;height:100%;width:40%;background:#ff542b;animation:m 1.2s ease-in-out infinite alternate}@keyframes m{to{margin-left:60%}}</style>
<main><div class=k>Hellens Clipper · Pembayaran</div><h1 id=t>Memeriksa pembayaran…</h1><p id=m>Mohon tunggu, kami menunggu konfirmasi dari DOKU.</p><div class=bar id=bar><i></i></div><div id=a></div></main>
<script>
const q=new URLSearchParams(location.search),inv=q.get('inv')||'',port=+q.get('p')||0,T=document.getElementById('t'),M=document.getElementById('m'),A=document.getElementById('a'),bar=document.getElementById('bar');
const back=()=>{if(port>1023&&port<65536){A.innerHTML='';const a=document.createElement('a');a.className='b';a.href='http://127.0.0.1:'+port+'/#/akun';a.textContent='Kembali ke aplikasi';A.append(a)}};
let n=0;(async function poll(){let s=null;try{const r=await fetch('status?inv='+encodeURIComponent(inv));s=r.ok?await r.json():null}catch{}
 if(s&&s.status==='paid'){bar.remove();T.textContent='Pembayaran berhasil';M.textContent='Plan '+s.plan.toUpperCase()+' sudah aktif. Terima kasih! Kembali ke aplikasi untuk mulai memakainya.';return back()}
 if(s&&(s.status==='failed'||s.status==='expired')){bar.remove();T.textContent=s.status==='expired'?'Pembayaran kedaluwarsa':'Pembayaran gagal';M.textContent='Tidak ada biaya yang ditagihkan. Kamu bisa mencoba lagi dari halaman Akun di aplikasi.';return back()}
 if(++n>100){bar.remove();T.textContent='Masih menunggu';M.textContent='Konfirmasi belum masuk. Jika kamu sudah membayar, plan akan aktif otomatis begitu DOKU mengirim konfirmasi; cek halaman Akun di aplikasi beberapa menit lagi.';return back()}
 setTimeout(poll,3000)})();
</script></html>`;

http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && p === '/register') {
      const ip = clientIp(req);
      if (signupBlocked(ip)) return json(res, 429, { error: 'Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.' });
      const { email, name, password } = await body(req);
      const em = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json(res, 400, { error: 'Email tidak valid' });
      if (String(password || '').length < 8) return json(res, 400, { error: 'Password minimal 8 karakter' });
      if (!String(name || '').trim()) return json(res, 400, { error: 'Nama wajib diisi' });
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) return json(res, 409, { error: 'Email sudah terdaftar' });
      const first = !NO_AUTO_OWNER && !db.prepare('SELECT 1 FROM users LIMIT 1').get(); // dev: pengguna pertama = owner
      const r = db.prepare('INSERT INTO users (email,name,pw,role,created_at) VALUES (?,?,?,?,?)')
        .run(em, String(name).trim().slice(0, 80), hashPw(String(password)), first ? 'owner' : 'member', new Date().toISOString());
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
      signups.set(ip, [...(signups.get(ip) || []), Date.now()]);
      audit(em, 'user.register', em, first ? 'owner pertama' : null);
      return json(res, 200, { token: newSession(u.id), user: pub(u) });
    }
    if (req.method === 'POST' && p === '/login') {
      const { email, password } = await body(req);
      const em = String(email || '').trim().toLowerCase(), key = clientIp(req) + '|' + em;
      if (blocked(key)) { audit(em, 'user.login.blocked', em, clientIp(req)); return json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' }); }
      const u = expireIfDue(db.prepare('SELECT * FROM users WHERE email = ?').get(em));
      // hash dummy bila user tak ada, supaya waktu respons tidak membocorkan email terdaftar
      const ok = u ? checkPw(String(password || ''), u.pw) : (checkPw('x', hashPw('y')), false);
      if (!ok) { fail(key); return json(res, 401, { error: 'Email atau password salah' }); }
      if (u.disabled) return json(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' }); // dicek setelah password benar agar tak membocorkan email
      audit(em, 'user.login', em);
      return json(res, 200, { token: newSession(u.id), user: pub(u) });
    }
    if (req.method === 'GET' && p === '/content') return json(res, 200, { content: getContent() });
    if (req.method === 'GET' && p === '/plans') return json(res, 200, { plans: PLANS, billing: { enabled: doku.enabled(), env: doku.cfg().base.includes('sandbox') ? 'sandbox' : 'production' } });
    // --- Pembayaran DOKU. Notifikasi dan halaman kembali bersifat publik (notifikasi diverifikasi tanda tangannya); sisanya butuh login. ---
    if (req.method === 'POST' && p === '/billing/doku/notify') return notify(req, res, p);
    if (req.method === 'GET' && p === '/billing/status') { const o = db.prepare('SELECT status, plan, period, paid_at FROM orders WHERE invoice = ?').get(new URL(req.url, 'http://x').searchParams.get('inv') || ''); return o ? json(res, 200, o) : json(res, 404, { error: 'pesanan tidak ada' }); }
    if (req.method === 'GET' && p === '/billing/return') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:" }); return res.end(RETURN_PAGE); }
    const u = userFor(req);
    if (!u) return json(res, 401, { error: 'Belum login' });
    if (req.method === 'POST' && p === '/usage/consume') { // tagih n klip ke kuota bulan ini; 402 bila melebihi
      const n = Math.floor(Number((await body(req)).clips)), cap = PLANS[u.plan].clipsPerMonth;
      if (!(Math.abs(n) >= 1 && Math.abs(n) <= 50)) return json(res, 400, { error: 'jumlah klip tidak valid' });
      if (n < 0) { db.prepare('UPDATE usage SET clips = MAX(0, clips + ?) WHERE user_id = ? AND month = ?').run(n, u.id, month()); return json(res, 200, { used: used(u.id) }); } // refund render gagal
      const now = used(u.id);
      if (cap !== null && now + n > cap) return json(res, 402, { error: `Kuota ${PLANS[u.plan].name} habis (${now}/${cap} klip bulan ini). Upgrade plan untuk lanjut.` });
      db.prepare('INSERT INTO usage VALUES (?,?,?) ON CONFLICT(user_id, month) DO UPDATE SET clips = clips + ?').run(u.id, month(), n, n);
      return json(res, 200, { used: now + n });
    }
    if (p.startsWith('/admin/')) { // seluruh area admin: owner/admin saja
      if (!['owner', 'admin'].includes(u.role)) return json(res, 403, { error: 'Khusus admin' });
      if (req.method === 'GET' && p === '/admin/users')
        return json(res, 200, { users: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.plan, u.disabled, u.created_at, COALESCE(g.clips, 0) AS clips
          FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.month = ? ORDER BY u.id`).all(month()) });
      if (req.method === 'GET' && p === '/admin/orders')
        return json(res, 200, { orders: db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 100').all().map(o => ({ ...orderView(o), email: o.email })),
          revenue: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE status = 'paid'").get().n });
      if (req.method === 'GET' && p === '/admin/stats') {
        const byPlan = Object.fromEntries(db.prepare('SELECT plan, COUNT(*) n FROM users GROUP BY plan').all().map(r => [r.plan, r.n]));
        const months = db.prepare('SELECT month, SUM(clips) clips FROM usage GROUP BY month ORDER BY month DESC LIMIT 6').all().reverse();
        return json(res, 200, { users: db.prepare('SELECT COUNT(*) n FROM users').get().n, byPlan, clipsThisMonth: months.find(m => m.month === month())?.clips || 0, months });
      }
      if (req.method === 'GET' && p === '/admin/audit') { // kursor: ?before=<id terkecil yang sudah dimuat>; 50 baris per halaman
        const before = Number(new URL(req.url, 'http://x').searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const rows = db.prepare('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT 51').all(before);
        return json(res, 200, { audit: rows.slice(0, 50), more: rows.length > 50 });
      }
      if (req.method === 'POST' && p === '/admin/content') { // value null = kembalikan ke default
        const { key, value } = await body(req), c = CONTENT[key];
        if (!c) return json(res, 400, { error: 'konten tidak dikenal' });
        if (value === null) db.prepare('DELETE FROM content WHERE key = ?').run(key);
        else { let clean; try { clean = c.clean(value); } catch (e) { return json(res, 400, { error: e.message }); }
          db.prepare('INSERT INTO content VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
            .run(key, JSON.stringify(clean), new Date().toISOString(), u.email); }
        audit(u.email, value === null ? 'admin.content.reset' : 'admin.content', key);
        return json(res, 200, { content: getContent() });
      }
      if (req.method === 'POST' && p === '/admin/user-status') { // nonaktifkan / aktifkan akun
        const { userId, disabled } = await body(req), t = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
        if (!t) return json(res, 404, { error: 'user tidak ada' });
        if (t.id === u.id) return json(res, 400, { error: 'Tidak bisa menonaktifkan akun sendiri' });
        if (t.role === 'owner' && u.role !== 'owner') return json(res, 403, { error: 'Hanya owner yang boleh mengubah status owner' });
        db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, t.id);
        if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id); // keluarkan dari semua perangkat
        audit(u.email, disabled ? 'admin.disable' : 'admin.enable', t.email);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (p === '/admin/plan' || p === '/admin/role')) {
        const { userId, plan, role } = await body(req), t = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
        if (!t) return json(res, 404, { error: 'user tidak ada' });
        if (p === '/admin/plan') {
          if (!(plan in PLANS)) return json(res, 400, { error: 'plan tidak dikenal' });
          db.prepare('UPDATE users SET plan = ?, plan_until = NULL WHERE id = ?').run(plan, t.id); audit(u.email, 'admin.plan', t.email, `${t.plan} -> ${plan}`);
        } else {
          if (u.role !== 'owner') return json(res, 403, { error: 'Hanya owner yang boleh mengubah role' });
          if (!ROLES.includes(role)) return json(res, 400, { error: 'role tidak dikenal' });
          if (t.id === u.id) return json(res, 400, { error: 'Tidak bisa mengubah role sendiri (mencegah owner terakhir hilang)' });
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, t.id); audit(u.email, 'admin.role', t.email, `${t.role} -> ${role}`);
        }
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && p === '/me') return json(res, 200, { user: pub(u) });
    if (req.method === 'GET' && p === '/billing/orders') {
      db.prepare("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND created_at < ?").run(new Date(Date.now() - 36e5 - 6e5).toISOString());
      return json(res, 200, { orders: db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id).map(orderView) });
    }
    if (req.method === 'POST' && p === '/billing/checkout') {
      if (!doku.enabled()) return json(res, 503, { error: 'Pembayaran online belum diaktifkan. Hubungi admin.' });
      const { plan, period, app_port } = await body(req), price = PLANS[plan] && PLANS[plan].price && PLANS[plan].price[period];
      if (!price) return json(res, 400, { error: 'plan atau periode tidak dikenal' });
      if (RANK[u.plan] > RANK[plan]) return json(res, 400, { error: `Plan ${PLANS[u.plan].name} Anda lebih tinggi dari ${PLANS[plan].name}.` });
      if (u.plan === plan && !u.plan_until) return json(res, 400, { error: `Plan ${PLANS[plan].name} Anda diatur admin tanpa masa berlaku; hubungi admin.` });
      const now = Date.now(), recent = db.prepare('SELECT * FROM orders WHERE user_id = ? AND created_at > ? ORDER BY id DESC').all(u.id, new Date(now - 36e5).toISOString());
      const same = recent.find(o => o.status === 'pending' && o.plan === plan && o.period === period && o.url && new Date(o.created_at).getTime() > now - 45 * 6e4);
      if (same) return json(res, 200, { url: same.url, invoice: same.invoice, reused: true });          // pesanan yang sama masih terbuka: pakai lagi
      if (recent.length >= 8) return json(res, 429, { error: 'Terlalu banyak pesanan dalam satu jam. Coba lagi nanti.' });
      const invoice = invoiceId(), port = Number.isInteger(+app_port) && +app_port > 1023 && +app_port < 65536 ? +app_port : 0;
      const r = db.prepare('INSERT INTO orders (invoice,user_id,plan,period,amount,created_at) VALUES (?,?,?,?,?,?)').run(invoice, u.id, plan, period, price, new Date().toISOString());
      try {
        const { url } = await doku.createCheckout({ invoice, amount: price, title: `Hellens Clipper ${PLANS[plan].name} (${PERIOD_LABEL[period]})`,
          customer: { id: u.id, name: (u.name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 50) || 'Pengguna'), email: u.email },
          callbackUrl: `${doku.cfg().publicBase}/billing/return?inv=${invoice}${port ? '&p=' + port : ''}` });
        db.prepare('UPDATE orders SET url = ? WHERE id = ?').run(url, r.lastInsertRowid); audit(u.email, 'billing.checkout', invoice, `${plan}/${period} Rp${price}`);
        return json(res, 200, { url, invoice });
      } catch (e) { db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(r.lastInsertRowid); audit(u.email, 'billing.checkout.failed', invoice, e.message.slice(0, 200)); return json(res, 502, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/logout') {
      db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(req.headers.authorization.replace(/^Bearer /, ''))); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/password') {
      const { current, next } = await body(req);
      if (!checkPw(String(current || ''), u.pw)) return json(res, 401, { error: 'Password saat ini salah' });
      if (String(next || '').length < 8) return json(res, 400, { error: 'Password baru minimal 8 karakter' });
      db.prepare('UPDATE users SET pw = ? WHERE id = ?').run(hashPw(String(next)), u.id);
      audit(u.email, 'user.password', u.email);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // paksa login ulang di semua perangkat
      return json(res, 200, { token: newSession(u.id) });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) { json(res, 500, { error: err.message }); }
}).listen(PORT, HOST, () => console.log(`Hellens Central: http://${HOST}:${PORT}`));
// ponytail: HTTPS tidak ditangani di sini; di produksi taruh di belakang reverse proxy (lihat deploy/central/) dan set HOST, TRUST_PROXY, NO_AUTO_OWNER.
