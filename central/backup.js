// Consistent online backup of the central SQLite database (safe while the server is running).
//   node central/backup.js [dir]      keeps the 14 newest files named central-YYYY-MM-DD.db in dir (default ./backups next to the db)
const fs = require('fs'), path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');
const src = process.env.CENTRAL_DB || path.join(__dirname, 'central.db');
const dir = process.argv[2] || path.join(path.dirname(src), 'backups');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `central-${new Date().toISOString().slice(0, 10)}.db`);
backup(new DatabaseSync(src), out).then(() => {
  const old = fs.readdirSync(dir).filter(f => /^central-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log(`backup: ${out} (${fs.statSync(out).size} bytes)` + (old.length ? `, ${old.length} lama dihapus` : ''));
}).catch(e => { console.error('backup gagal:', e.message); process.exit(1); });
