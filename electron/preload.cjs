// Preload: expose a tiny, safe API to the renderer (contextIsolation is on).
// renderPdf(html) → base64 PDF string, rendered by Electron's native print-to-PDF
// (honors @media print + dark backgrounds), so saved quote PDFs match the
// builder's own working "Save / Print PDF" output instead of an html2canvas
// rasterization that came out blank.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  renderPdf: (html) => ipcRenderer.invoke('ss:render-pdf', html),
})
