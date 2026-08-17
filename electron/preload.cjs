// Preload: expose a tiny, safe API to the renderer (contextIsolation is on).
// renderPdf(html) → base64 PDF string, rendered by Electron's native print-to-PDF
// (honors @media print + dark backgrounds), so saved quote PDFs match the
// builder's own working "Save / Print PDF" output instead of an html2canvas
// rasterization that came out blank.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  renderPdf: (html) => ipcRenderer.invoke('ss:render-pdf', html),
  // Main-process confirm/alert — replaces the renderer-native dialogs, whose
  // Chromium bug on Windows kills keyboard input to the window after closing.
  confirmSync: (msg) => ipcRenderer.sendSync('ss:confirm', msg),
  alertSync: (msg) => ipcRenderer.sendSync('ss:alert', msg),
})
