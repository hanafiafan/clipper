// Locate a Chrome/Chromium executable for puppeteer-core (badge rendering, icon generation).
const fs = require('fs'), path = require('path');
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
  // Windows: Microsoft Edge (Chromium) ships with Windows 10/11, so it is the reliable fallback; Chrome is preferred when present.
  const win = ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].filter(k => process.env[k]).flatMap(k => [
    path.join(process.env[k], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env[k], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  win.sort((a, b) => /chrome\.exe$/.test(b) - /chrome\.exe$/.test(a)); // Chrome before Edge (stable sort keeps env order)
  for (const sys of [ // fall back to a system Chrome/Chromium
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ...win,
  ]) if (fs.existsSync(sys)) return sys;
  return undefined;
}

module.exports = { findChrome };
