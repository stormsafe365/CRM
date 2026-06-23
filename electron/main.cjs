// StormSafe CRM — Electron desktop shell.
//
// The CRM is a multi-route SPA with absolute asset paths and nested same-origin
// builder iframes (/build/build.html → /build/quote-builder.html). file:// would
// break all of that, so in the packaged app we spin up a TINY internal static
// server over the bundled `dist/` and point the window at it — identical to how
// the dev server behaves, just self-contained. No external server, no terminal.
//
// Data still lives in Supabase (cloud), reached over https/wss like always.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const isDev = !app.isPackaged && process.env.ELECTRON_SERVE_DIST !== '1';

let server = null;
let mainWindow = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.map': 'application/json', '.pdf': 'application/pdf',
};

// Serve `distDir` on a STABLE localhost port (so per-origin storage like the
// Follow-Up HQ calendar's localStorage survives app restarts), with SPA fallback
// to index.html for extension-less routes. Falls back to a random port if taken.
const APP_PORT = 31624;
function startServer(distDir) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        let filePath = path.normalize(path.join(distDir, urlPath));
        if (!filePath.startsWith(distDir)) { res.statusCode = 403; return res.end('Forbidden'); }

        let st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (!st || !st.isFile()) {
          if (!path.extname(urlPath)) {
            filePath = path.join(distDir, 'index.html'); // SPA fallback
          } else {
            res.statusCode = 404; return res.end('Not found');
          }
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.statusCode = 500; res.end('Server error');
      }
    });
    srv.once('error', (e) => {
      if (e && e.code === 'EADDRINUSE') {
        const s2 = http.createServer(srv.listeners('request')[0]);
        s2.on('error', reject);
        s2.listen(0, '127.0.0.1', () => resolve(s2)); // fallback to a free port
      } else reject(e);
    });
    srv.listen(APP_PORT, '127.0.0.1', () => resolve(srv));
  });
}

async function createWindow() {
  let startUrl;
  if (isDev) {
    startUrl = 'http://localhost:3001';
  } else {
    const distDir = path.join(__dirname, '..', 'dist');
    server = await startServer(distDir);
    startUrl = `http://127.0.0.1:${server.address().port}/`;
  }

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#08121d',
    title: 'StormSafe CRM',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // The app only ever loads its OWN local content; relaxing this lets the
      // builder read its same-page pricing iframe without origin friction.
      webSecurity: false,
    },
  });

  mainWindow.loadURL(startUrl);

  // Internal links stay in-app; external (https) links open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (server) { try { server.close(); } catch { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});
