// Render a rounded pill badge (text + emoji) to a tight transparent PNG via headless Chrome.
// Uses puppeteer-core (project dependency) with a system Chrome/Chromium; set PUPPETEER_EXECUTABLE_PATH to override.
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');
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
// Resolve a Chrome executable: env override, puppeteer's own, or scan its cache.
function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const base = path.join(require('os').homedir(), '.cache', 'puppeteer', 'chrome');
  for (const dir of (fs.existsSync(base) ? fs.readdirSync(base) : [])) {
    for (const sub of ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-linux64']) {
      const d = path.join(base, dir, sub);
      if (!fs.existsSync(d)) continue;
      const mac = path.join(d, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(mac)) return mac;
      const lin = path.join(d, 'chrome'); if (fs.existsSync(lin)) return lin;
    }
  }
  for (const sys of [ // fall back to a system Chrome/Chromium
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]) if (fs.existsSync(sys)) return sys;
  return undefined;
}
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1 }); // 1:1 so PNG pixels == video coords (no overflow)
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('#b');
  await el.screenshot({ path: outPath, omitBackground: true });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
