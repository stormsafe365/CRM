// StormSafe CRM — Electron desktop shell.
//
// The CRM is a multi-route SPA with absolute asset paths and nested same-origin
// builder iframes (/build/build.html → /build/quote-builder.html). file:// would
// break all of that, so in the packaged app we spin up a TINY internal static
// server over the bundled `dist/` and point the window at it — identical to how
// the dev server behaves, just self-contained. No external server, no terminal.
//
// Data still lives in Supabase (cloud), reached over https/wss like always.

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Render an HTML document to a PDF (Buffer) using Chromium's native print-to-PDF.
// Used to save quote PDFs that honor the builder's print styles + dark theme.
async function htmlToPdfBuffer(html) {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false, javascript: true } });
  try {
    await w.loadURL('about:blank');
    await w.webContents.executeJavaScript(
      `document.open();document.write(${JSON.stringify(String(html || ''))});document.close();`
    );
    await new Promise((r) => setTimeout(r, 600)); // let fonts/images settle
    return await w.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', landscape: false });
  } finally {
    try { w.destroy(); } catch { /* ignore */ }
  }
}
const cleanPdfName = (name) => {
  const n = String(name || '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'StormSafe Steel';
  return /\.pdf$/i.test(n) ? n : n + '.pdf';
};

// Default file name for the NEXT PDF the user downloads from a viewer, set by
// renderPdf (kept for other callers; the quote/contract buttons use savePdf).
let pendingPdfName = null;
ipcMain.handle('ss:render-pdf', async (_evt, html, name) => {
  pendingPdfName = name ? String(name).replace(/[\\/:*?"<>|]+/g, '').trim() : null;
  const buf = await htmlToPdfBuffer(html);
  return buf.toString('base64');
});

// "Save / Print PDF" in the pricing program (quotes + contracts): render, then a
// real Windows Save dialog PRE-FILLED with e.g. "Tarek Gabra-StormSafe Steel QTE
// (9.29).pdf" (the PDF viewer's own save button can't be pre-filled — it showed
// a blank name), then open the saved file in an in-app viewer for preview.
// defaultPath is just the file name, so Windows opens the folder used last time.
ipcMain.handle('ss:save-pdf', async (evt, { html, suggestedName } = {}) => {
  try {
    const pdf = await htmlToPdfBuffer(html);
    const parent = BrowserWindow.fromWebContents(evt.sender) || BrowserWindow.getFocusedWindow() || undefined;
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Save PDF',
      defaultPath: cleanPdfName(suggestedName),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, pdf);
    try {
      const viewer = new BrowserWindow({ width: 1100, height: 900, title: path.basename(filePath), webPreferences: { plugins: true } });
      viewer.setMenuBarVisibility(false);
      viewer.webContents.on('did-fail-load', () => { try { viewer.destroy(); } catch { /* ignore */ } shell.openPath(filePath); });
      await viewer.loadURL('file:///' + filePath.replace(/\\/g, '/'));
    } catch {
      shell.openPath(filePath); // fall back to the default PDF app
    }
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// Native window.confirm()/alert() in the renderer trigger a long-standing
// Electron/Chromium bug on Windows: after the dialog closes, text inputs across
// the whole window stop accepting KEYBOARD input (mouse keeps working) until
// the window is blurred and refocused. The CRM confirms on stage changes,
// deletes, cadence prompts, etc., so this froze the activity composer.
// Fix: swap them for main-process dialogs (no bug) + an explicit focus nudge.
ipcMain.on('ss:confirm', (e, msg) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = dialog.showMessageBoxSync(win, {
    type: 'question', buttons: ['OK', 'Cancel'], defaultId: 0, cancelId: 1,
    title: 'StormSafe CRM', message: String(msg ?? ''),
  });
  setImmediate(() => { if (win && !win.isDestroyed()) win.webContents.focus(); });
  e.returnValue = r === 0;
});
ipcMain.on('ss:alert', (e, msg) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  dialog.showMessageBoxSync(win, {
    type: 'info', buttons: ['OK'], title: 'StormSafe CRM', message: String(msg ?? ''),
  });
  setImmediate(() => { if (win && !win.isDestroyed()) win.webContents.focus(); });
  e.returnValue = true;
});

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
      preload: path.join(__dirname, 'preload.cjs'),
      // The app only ever loads its OWN local content; relaxing this lets the
      // builder read its same-page pricing iframe without origin friction.
      webSecurity: false,
    },
  });

  mainWindow.loadURL(startUrl);

  // PDF viewer "download" → pre-fill the Save dialog with the quote/contract name.
  mainWindow.webContents.session.on('will-download', (_e, item) => {
    const isPdf = item.getMimeType() === 'application/pdf' || /\.pdf$/i.test(item.getFilename());
    if (!isPdf || !pendingPdfName) return;
    const fname = /\.pdf$/i.test(pendingPdfName) ? pendingPdfName : pendingPdfName + '.pdf';
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), fname), filters: [{ name: 'PDF Document', extensions: ['pdf'] }] });
  });

  // Window-open routing:
  //  • about:/data:/blank + our own pages  → open IN-APP (the pricing program's
  //    "Save / Print PDF" and "Generate Contract" open a blank popup and write the
  //    print document into it — these must NOT be handed to the OS).
  //  • real web links + mailto/tel/sms      → open in the OS default app.
  //  • anything else                         → open in-app (never hand odd schemes
  //    to the OS, which causes the "no app to open this link" popup).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url === 'about:blank' ||
      url.startsWith('about:') ||
      url.startsWith('data:') ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('http://localhost')
    ) {
      return { action: 'allow' };
    }
    if (/^(https?|mailto|tel|sms):/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Replace the page's native confirm/alert with the main-process versions
  // (see the ss:confirm/ss:alert handlers above for why). Runs on every load
  // so it survives reloads; no renderer code changes needed.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      if (window.electronAPI && window.electronAPI.confirmSync) {
        window.confirm = (m) => window.electronAPI.confirmSync(m);
        window.alert = (m) => { window.electronAPI.alertSync(m); };
      }
    `).catch(() => { /* page navigated away mid-inject — harmless */ });
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
