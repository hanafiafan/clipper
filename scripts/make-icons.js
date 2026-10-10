// Build the desktop app icons from brand/logo.svg:  node scripts/make-icons.js   (npm run icons)
//   build/icon.png   1024x1024 rounded square with transparent corners (also used by electron-builder for Windows/Linux)
//   build/icon.icns  macOS icon set (needs macOS: sips + iconutil; skipped elsewhere)
//   brand/tray-template.png (+@2x)  black mark on transparent, a macOS "template image" for the menu bar
//   brand/tray.png                  64x64 coloured logo tile for the Windows notification area
// Needs Chrome/Chromium (see scripts/chrome.js).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { findChrome } = require('./chrome');

const root = path.join(__dirname, '..'), out = path.join(root, 'build');
const svg = fs.readFileSync(path.join(root, 'brand', 'logo.svg'), 'utf8').replace(/<svg /, '<svg width="1024" height="1024" ');
// The supplied artwork sits ~41px below the true centre of its 564 canvas (mark centre 295,323 vs 282,282); recentre it for the icon.
const recentred = svg.replace('transform="translate(0 0)"', 'transform="translate(-13 -41)"');
const html = `<!doctype html><style>*{margin:0}html,body{background:transparent}
#i{width:1024px;height:1024px;border-radius:230px;overflow:hidden;background:#FF6A00}svg{display:block}</style><div id="i">${recentred}</div>`;

(async () => {
  const puppeteer = (m => m.default || m)(await import('puppeteer-core')); // ESM-only package
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = path.join(out, 'icon.png');
  await (await page.$('#i')).screenshot({ path: png, omitBackground: true });
  // Tray icons. macOS menu-bar icons must be monochrome "template" images (the system tints them for light/dark), so use only the mark.
  const mark = fs.readFileSync(path.join(root, 'brand', 'logo-mark.svg'), 'utf8');
  for (const [file, px] of [['tray-template.png', 22], ['tray-template@2x.png', 44]]) {
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent;width:${px}px;height:${px}px;display:grid;place-items:center}svg{width:${px - 2}px;height:auto}</style>${mark}`);
    await page.screenshot({ path: path.join(root, 'brand', file), omitBackground: true });
  }
  await page.setViewport({ width: 64, height: 64, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}#t{width:64px;height:64px;border-radius:15px;background:#FF6A00;display:grid;place-items:center}svg{width:46px;height:auto}</style><div id="t">${mark}</div>`);
  await (await page.$('#t')).screenshot({ path: path.join(root, 'brand', 'tray.png'), omitBackground: true });
  console.log('wrote brand/tray-template.png, brand/tray-template@2x.png, brand/tray.png');
  await browser.close();
  fs.copyFileSync(png, path.join(out, 'icon-master.png'));
  console.log('wrote build/icon.png, build/icon-master.png');

  if (process.platform !== 'darwin') return console.log('skip icon.icns (needs macOS iconutil)');
  const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hellens-')), 'icon.iconset'); fs.mkdirSync(set);
  for (const [name, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256],
    ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]])
    execFileSync('sips', ['-z', px, px, png, '--out', path.join(set, `icon_${name}.png`)], { stdio: 'ignore' });
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
  console.log('wrote build/icon.icns');
})().catch(e => { console.error(e.message); process.exit(1); });
