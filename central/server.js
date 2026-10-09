// Hellens Central: akun, sesi, role. Zero-dep (node:sqlite, node 22+). Video & render tetap di app lokal user.
// Jalankan: node central/server.js  (PORT=4000, CENTRAL_DB=path ke file sqlite)
const http = require('http'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = process.env.PORT || 4000;
const db = new DatabaseSync(process.env.CENTRAL_DB || path.join(__dirname, 'central.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL);
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
    if (req.method === 'GET' && p === '/me') return json(res, 200, { user: pub(u) });
    if (req.method === 'POST' && p === '/logout') {
      db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(req.headers.authorization.replace(/^Bearer /, ''))); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/password') {
      const { current, next } = await body(req);
      if (!checkPw(String(current || ''), u.pw)) return json(res, 401, { error: 'Password saat ini salah' });
      if (String(next || '').length < 8) return json(res, 400, { error: 'Password baru minimal 8 karakter' });
      db.prepare('UPDATE users SET pw = ? WHERE id = ?').run(hashPw(String(next)), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // paksa login ulang di semua perangkat
      return json(res, 200, { token: newSession(u.id) });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) { json(res, 500, { error: err.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Hellens Central: http://127.0.0.1:${PORT}`));
// ponytail: bind 127.0.0.1 untuk dev; saat deploy publik taruh di belakang HTTPS reverse proxy dan ubah host bind.
