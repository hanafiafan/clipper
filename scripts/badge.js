// Render a rounded pill badge (text + emoji) to a tight transparent PNG via headless Chrome.
// Uses puppeteer-core (project dependency) with a system Chrome/Chromium; set PUPPETEER_EXECUTABLE_PATH to override.
const fs = require('fs'), path = require('path');
const [, , outPath, dataJson] = process.argv;
const d = JSON.parse(dataJson);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64 = fs.existsSync(d.fontFile) ? fs.readFileSync(d.fontFile).toString('base64') : null;
const face = b64 ? `@font-face{font-family:'Badge';src:url(data:font/ttf;base64,${b64}) format('truetype');}` : '';
// Cap the badge width to fit the video frame and wrap long text onto multiple lines (centered).
const maxW = d.maxW ? Math.round(d.maxW * 0.88) : null;
const html = `<!doctype html><meta charset=utf-8><style>${face}
*{margin:0}body{background:transparent}
#b{display:inline-block;font-family:'Badge','Apple Color Emoji',system-ui;font-size:${d.size}px;line-height:1.12;
color:${d.color};background:${d.bg};padding:${Math.round(d.size*0.3)}px ${Math.round(d.size*0.55)}px;
border-radius:${Math.round(d.size*(d.rounded?0.6:0.1))}px;text-align:center;
${maxW ? `max-width:${maxW}px;` : ''}white-space:${maxW ? 'normal' : 'nowrap'};word-break:break-word;overflow-wrap:anywhere}</style><body><span id=b>${esc(d.text)}</span>`;
const { findChrome } = require('./chrome');
(async () => {
  // puppeteer-core is ESM-only: require() of it fails on Electron 33's Node, dynamic import() works everywhere.
  const puppeteer = (m => m.default || m)(await import('puppeteer-core'));
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1 }); // 1:1 so PNG pixels == video coords (no overflow)
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('#b');
  await el.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
