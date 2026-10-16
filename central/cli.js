// Admin CLI for the central database (run on the server, e.g. `docker exec clipper-central node cli.js promote you@mail.com owner`).
//   node central/cli.js list
//   node central/cli.js promote <email> <owner|admin|member>
//   node central/cli.js plan <email> <free|pro|enterprise>
// Reads CENTRAL_DB like the server does. Every change is written to the audit log as actor "cli".
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.CENTRAL_DB || path.join(__dirname, 'central.db'));
const [cmd, email, value] = process.argv.slice(2);
const log = (action, target, detail) => db.prepare('INSERT INTO audit (at,actor,action,target,detail) VALUES (?,?,?,?,?)').run(new Date().toISOString(), 'cli', action, target, detail);
const find = e => db.prepare('SELECT * FROM users WHERE email = ?').get(String(e || '').trim().toLowerCase());
const die = m => { console.error(m); process.exit(1); };

if (cmd === 'list') {
  for (const u of db.prepare('SELECT id,email,name,role,plan,disabled,created_at FROM users ORDER BY id').all())
    console.log(`${String(u.id).padStart(3)}  ${u.role.padEnd(6)} ${u.plan.padEnd(10)} ${u.disabled ? 'NONAKTIF ' : ''}${u.email}  (${u.name})`);
} else if (cmd === 'promote') {
  if (!['owner', 'admin', 'member'].includes(value)) die('role harus owner, admin, atau member');
  const u = find(email) || die('user tidak ditemukan: ' + email);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(value, u.id); log('cli.role', u.email, `${u.role} -> ${value}`);
  console.log(`${u.email}: ${u.role} -> ${value}`);
} else if (cmd === 'plan') {
  if (!['free', 'pro', 'enterprise'].includes(value)) die('plan harus free, pro, atau enterprise');
  const u = find(email) || die('user tidak ditemukan: ' + email);
  db.prepare('UPDATE users SET plan = ?, plan_until = NULL WHERE id = ?').run(value, u.id); log('cli.plan', u.email, `${u.plan} -> ${value}`);
  console.log(`${u.email}: ${u.plan} -> ${value}`);
} else if (cmd === 'doku-check') {
  // Probe the DOKU credentials in the environment with an empty order: DOKU checks Client-Id and signature before the body, so no order is created and nothing is charged.
  const doku = require('./doku'), c0 = doku.cfg(), env = c0.base.includes('sandbox') ? 'sandbox' : 'production';
  if (!doku.enabled()) die(`DOKU belum dikonfigurasi (butuh DOKU_CLIENT_ID, DOKU_SECRET_KEY, PUBLIC_URL). Lingkungan: ${env}`);
  doku.call('POST', '/checkout/v1/payment', { order: { amount: 0, invoice_number: 'HC-CHECK' }, payment: { payment_due_date: 1 } }).then(   // amount 0 is rejected by validation, so nothing is created
    ({ status, j }) => {
    const code = j && j.error && j.error.code, id = c0.clientId.slice(0, 8) + '…';
    if (code === 'invalid_client_id') die(`GAGAL: Client ID ${id} tidak dikenal di ${env}.`);
    if (code === 'invalid_signature') die(`GAGAL: Client ID ${id} dikenal di ${env}, tetapi Secret Key tidak cocok.`);
    if (status === 400 && j && !j.error && (j.error_messages || j.message)) return console.log(`OK: kredensial diterima DOKU (${env}, Client ID ${id}).`);
    die(`TIDAK PASTI: DOKU menjawab HTTP ${status}: ${JSON.stringify(j).slice(0, 200)}`);
  }).catch(e => die('GAGAL menghubungi DOKU: ' + e.message));
} else die('pakai: list | promote <email> <role> | plan <email> <plan> | doku-check');
