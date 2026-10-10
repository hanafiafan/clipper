// Hellens Clipper desktop host. There is no application window: this process runs the local server (server.js) in the
// background, sits in the menu bar (macOS) / notification area (Windows) and opens the UI in the user's default browser,
// which lands on the login page. The browser tab is the frontend; this app is only the backend.
//   KLIP_NO_BROWSER=1  do not open the browser (used by tests)
const { app, Tray, Menu, BrowserWindow, shell, nativeImage, Notification } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');

let url = '', tray = null, lastOpen = 0;

// When packaged, bundled binaries (ffmpeg/yt-dlp/whisper-cli) + model live in resources/.
function wireResources() {
  // Installed builds talk to the hosted account server unless CENTRAL_URL says otherwise (development keeps http://127.0.0.1:4000).
  if (app.isPackaged && !process.env.CENTRAL_URL) process.env.CENTRAL_URL = 'https://clipper.hellens.dev/api';
  if (!app.isPackaged) return;
  const resDir = process.resourcesPath;
  const binDir = path.join(resDir, 'bin');
  process.env.PATH = binDir + path.delimiter + (process.env.PATH || ''); // find bundled binaries first
  const model = path.join(resDir, 'models', 'ggml-base.bin');
  if (!process.env.WHISPER_MODEL) process.env.WHISPER_MODEL = model;
}

// First free port starting at the preferred one, so a dev server or another program never prevents startup.
const freePort = start => new Promise((resolve, reject) => {
  const attempt = p => {
    const s = net.createServer();
    s.once('error', () => (p < start + 20 ? attempt(p + 1) : reject(new Error('Tidak ada port yang kosong'))));
    s.once('listening', () => s.close(() => resolve(p)));
    s.listen(p, '127.0.0.1');
  };
  attempt(start);
});

const waitForServer = (tries = 100) => new Promise(resolve => {
  const probe = () => http.get(url, r => { r.resume(); resolve(true); }).on('error', () => (tries-- > 0 ? setTimeout(probe, 150) : resolve(false)));
  probe();
});

// 127.0.0.1 (not "localhost"): the server only listens on IPv4 loopback and the session cookie is bound to this exact host.
function openUI() {
  if (Date.now() - lastOpen < 1500) return;          // relaunch fires several events at once; open one tab
  lastOpen = Date.now();
  if (process.env.KLIP_NO_BROWSER === '1') return console.log('open ' + url);
  shell.openExternal(url);
}

function trayImage() {
  const dir = path.join(__dirname, 'brand');
  if (process.platform === 'darwin') { const img = nativeImage.createFromPath(path.join(dir, 'tray-template.png')); img.setTemplateImage(true); return img; }
  return nativeImage.createFromPath(path.join(dir, 'tray.png')).resize({ width: 16, height: 16 });
}

const loginSettings = () => app.getLoginItemSettings({ args: ['--hidden'] });
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Buka Hellens Clipper', click: openUI },
    { label: url.replace('http://', ''), enabled: false },
    { type: 'separator' },
    { label: 'Jalankan saat login', type: 'checkbox', checked: loginSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() },
  ]);
}

// Tell the user once where the app went, since it has no window or Dock icon.
function announceOnce() {
  const flag = path.join(app.getPath('userData'), 'first-run-done');
  if (fs.existsSync(flag) || !Notification.isSupported()) return;
  fs.writeFileSync(flag, new Date().toISOString());
  new Notification({ title: 'Hellens Clipper berjalan di latar belakang', body: 'Tampilannya terbuka di browser. Klik ikonnya di ' + (process.platform === 'darwin' ? 'menu bar' : 'area notifikasi') + ' untuk membukanya lagi atau keluar.' }).show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();                                         // already running: that instance opens a tab for us (second-instance below)
} else {
  app.on('second-instance', openUI);
  app.on('activate', openUI);                         // macOS: clicking the app in Finder/Launchpad again
  app.on('window-all-closed', () => {});              // never quit just because no window exists

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();
    app.setAppUserModelId('com.hellens.app');
    process.env.KLIP_DATA = app.getPath('userData');  // writable data dir
    wireResources();
    const port = await freePort(+process.env.PORT || 3002);
    process.env.PORT = String(port);
    url = `http://127.0.0.1:${port}`;
    require('./server.js');                           // starts listening on PORT

    tray = new Tray(trayImage());
    tray.setToolTip('Hellens Clipper');
    tray.setContextMenu(buildMenu());
    tray.on('click', openUI);                         // Windows: left click; macOS shows the menu instead

    await waitForServer();
    if (process.env.KLIP_NO_BROWSER === '1') console.log('selftest', JSON.stringify({ trayBounds: tray.getBounds(), windows: BrowserWindow.getAllWindows().length, dockVisible: process.platform === 'darwin' ? app.dock.isVisible() : null }));
    const atLogin = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (!atLogin) openUI();                           // started by hand: show the login page; at login: stay quiet
    announceOnce();
  });
}
