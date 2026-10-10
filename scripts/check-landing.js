// Static integrity checks for the landing page (run in CI): node scripts/check-landing.js [dir]
// Every local href/src/url() must exist, every #fragment and <use href="#id"> must have a target, ids are unique,
// aria-controls targets exist, there is exactly one <h1>, images have alt text, and the OpenGraph image is absolute.
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'landing'));
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const errors = [], err = m => errors.push(m);
const remote = u => /^(https?:|mailto:|data:|\/\/)/i.test(u);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) err(`duplicate id "${id}"`);

for (const [, u] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
  if (remote(u)) continue;
  if (u.startsWith('#')) { if (u.length > 1 && !ids.includes(u.slice(1))) err(`missing anchor target ${u}`); continue; }
  if (!fs.existsSync(path.join(dir, u.split(/[?#]/)[0]))) err(`missing file for "${u}"`);
}
for (const [, u0] of css.matchAll(/url\(([^)]+)\)/g)) {
  const u = u0.replace(/^['"]|['"]$/g, '');
  if (!remote(u) && !fs.existsSync(path.join(dir, u.split(/[?#]/)[0]))) err(`missing file in styles.css url(${u})`);
}
for (const [, v] of html.matchAll(/aria-controls="([^"]+)"/g)) for (const id of v.split(/\s+/)) if (!ids.includes(id)) err(`aria-controls points to missing id "${id}"`);

const h1 = (html.match(/<h1[\s>]/g) || []).length; if (h1 !== 1) err(`expected exactly one <h1>, found ${h1}`);
for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) err(`<img> without alt: ${m[0].slice(0, 70)}`);
if (!/<html[^>]*\blang="/.test(html)) err('missing <html lang>');
const og = (html.match(/property="og:image"\s+content="([^"]+)"/) || [])[1];
if (!og || !/^https:\/\//.test(og)) err(`og:image must be an absolute https URL (got ${og})`);

if (errors.length) { console.error('Landing page problems:\n - ' + errors.join('\n - ')); process.exit(1); }
console.log(`landing OK: ${ids.length} ids, ${[...html.matchAll(/\s(?:href|src)="[^"#][^"]*"/g)].length} refs checked`);
