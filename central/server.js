// Hellens Central: akun, sesi, role. Zero-dep (node:sqlite, node 22+). Video & render tetap di app lokal user.
// Jalankan: node central/server.js  (PORT=4000, CENTRAL_DB=path ke file sqlite)
const http = require('http'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = process.env.PORT || 4000;
const db = new DatabaseSync(process.env.CENTRAL_DB || path.join(__dirname, 'central.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
  CREATE TABLE IF NOT EXISTS content (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL,
    clips INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month));
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);`);

const SESSION_MS = 7 * 864e5;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const hashPw = pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => { const [s, h] = stored.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex')); };
// Definisi plan di kode (bukan DB): harga/limit berubah lewat deploy. null = tanpa batas.
const PLANS = {
  free:       { name: 'Free',       clipsPerMonth: 10,   maxResolution: '720p',  clipsPerJob: 3 },
  pro:        { name: 'Pro',        clipsPerMonth: 100,  maxResolution: '1080p', clipsPerJob: 6 },
  enterprise: { name: 'Enterprise', clipsPerMonth: null, maxResolution: '4k',    clipsPerJob: 6 },
};
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
               pro: { price: 'Hubungi admin', tagline: 'Untuk kreator aktif', features: ['Kuota lebih besar', 'Resolusi hingga 1080p'] },
               enterprise: { price: 'Hubungi kami', tagline: 'Untuk tim & agensi', features: ['Tanpa batas klip', 'Resolusi hingga 4K', 'Dukungan prioritas'] } },
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
const pub = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, limits: PLANS[u.plan], usage: { month: month(), clips: used(u.id) } });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
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
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?').get(sha(t)) || null;
}

// ponytail: rate limit in-memory per IP+email; pindah ke tabel kalau pusat di-scale ke banyak proses.
const fails = new Map();
const blocked = k => (fails.get(k) || []).filter(t => Date.now() - t < 9e5).length >= 5;
const fail = k => fails.set(k, [...(fails.get(k) || []).filter(t => Date.now() - t < 9e5), Date.now()]);

http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (req.method === 'POST' && p === '/register') {
      const { email, name, password } = await body(req);
      const em = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json(res, 400, { error: 'Email tidak valid' });
      if (String(password || '').length < 8) return json(res, 400, { error: 'Password minimal 8 karakter' });
      if (!String(name || '').trim()) return json(res, 400, { error: 'Nama wajib diisi' });
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) return json(res, 409, { error: 'Email sudah terdaftar' });
      const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get(); // pengguna pertama = owner
      const r = db.prepare('INSERT INTO users (email,name,pw,role,created_at) VALUES (?,?,?,?,?)')
        .run(em, String(name).trim().slice(0, 80), hashPw(String(password)), first ? 'owner' : 'member', new Date().toISOString());
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
      audit(em, 'user.register', em, first ? 'owner pertama' : null);
      return json(res, 200, { token: newSession(u.id), user: pub(u) });
    }
    if (req.method === 'POST' && p === '/login') {
      const { email, password } = await body(req);
      const em = String(email || '').trim().toLowerCase(), key = req.socket.remoteAddress + '|' + em;
      if (blocked(key)) return json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
      const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
      // hash dummy bila user tak ada, supaya waktu respons tidak membocorkan email terdaftar
      const ok = u ? checkPw(String(password || ''), u.pw) : (checkPw('x', hashPw('y')), false);
      if (!ok) { fail(key); return json(res, 401, { error: 'Email atau password salah' }); }
      return json(res, 200, { token: newSession(u.id), user: pub(u) });
    }
    if (req.method === 'GET' && p === '/content') return json(res, 200, { content: getContent() });
    if (req.method === 'GET' && p === '/plans') return json(res, 200, { plans: PLANS });
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
        return json(res, 200, { users: db.prepare(`SELECT u.id, u.email, u.name, u.role, u.plan, u.created_at, COALESCE(g.clips, 0) AS clips
          FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.month = ? ORDER BY u.id`).all(month()) });
      if (req.method === 'GET' && p === '/admin/stats') {
        const byPlan = Object.fromEntries(db.prepare('SELECT plan, COUNT(*) n FROM users GROUP BY plan').all().map(r => [r.plan, r.n]));
        const months = db.prepare('SELECT month, SUM(clips) clips FROM usage GROUP BY month ORDER BY month DESC LIMIT 6').all().reverse();
        return json(res, 200, { users: db.prepare('SELECT COUNT(*) n FROM users').get().n, byPlan, clipsThisMonth: months.find(m => m.month === month())?.clips || 0, months });
      }
      if (req.method === 'GET' && p === '/admin/audit') return json(res, 200, { audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() });
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
      if (req.method === 'POST' && (p === '/admin/plan' || p === '/admin/role')) {
        const { userId, plan, role } = await body(req), t = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
        if (!t) return json(res, 404, { error: 'user tidak ada' });
        if (p === '/admin/plan') {
          if (!(plan in PLANS)) return json(res, 400, { error: 'plan tidak dikenal' });
          db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, t.id); audit(u.email, 'admin.plan', t.email, `${t.plan} -> ${plan}`);
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
}).listen(PORT, '127.0.0.1', () => console.log(`Hellens Central: http://127.0.0.1:${PORT}`));
// ponytail: bind 127.0.0.1 untuk dev; saat deploy publik taruh di belakang HTTPS reverse proxy dan ubah host bind.
