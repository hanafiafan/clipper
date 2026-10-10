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
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(value, u.id); log('cli.plan', u.email, `${u.plan} -> ${value}`);
  console.log(`${u.email}: ${u.plan} -> ${value}`);
} else die('pakai: list | promote <email> <role> | plan <email> <plan>');
