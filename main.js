// Electron wrapper: starts the local server and shows the UI in a desktop window.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || '3002';
const URL = `http://localhost:${PORT}`;

// When packaged, bundled binaries (ffmpeg/yt-dlp/whisper-cli) + model live in resources/.
function wireResources() {
  if (!app.isPackaged) return;
  const resDir = process.resourcesPath;
  const binDir = path.join(resDir, 'bin');
  process.env.PATH = binDir + path.delimiter + (process.env.PATH || ''); // find bundled binaries first
  const model = path.join(resDir, 'models', 'ggml-base.bin');
  if (!process.env.WHISPER_MODEL) process.env.WHISPER_MODEL = model;
}

function waitForServer(cb, tries = 60) {
  http.get(URL, () => cb()).on('error', () => tries > 0 ? setTimeout(() => waitForServer(cb, tries - 1), 150) : cb());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 860, minWidth: 720, backgroundColor: '#0c0e13',
    title: 'Hellens Clipper', webPreferences: { contextIsolation: true },
  });
  win.loadURL(URL);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  process.env.KLIP_DATA = app.getPath('userData'); // writable data dir
  wireResources();
  require('./server.js'); // starts listening on PORT
  waitForServer(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
