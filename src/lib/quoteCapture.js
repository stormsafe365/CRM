// quoteCapture: read-only bridge to the embedded QTEPRO builder.
//
// Hard rules honored here:
//  • The builder/pricing engine is NEVER modified or re-derived. We only READ
//    the engine's own on-screen totals and its print output.
//  • Customer-facing output stays StormSafe-branded (manufacturer names live
//    only in the builder's internal config, never in printQuote's HTML).
//
// html2pdf (~1 MB with html2canvas + jsPDF) is imported lazily inside
// htmlToPdfBlob so it only loads when a quote is actually saved.

function parseMoney(text) {
  if (text == null) return null
  const n = Number(String(text).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Totals straight from the builder's displayed Price Breakdown — the exact
// numbers the rep sees and the customer is quoted (#ptot/#pdep/#pbal). Because
// these are the engine's rendered outputs, a saved total matches the builder
// to the dollar by construction.
export function readBuilderTotals(win) {
  const G = win.G
  if (typeof G !== 'function') throw new Error('Builder not ready.')
  return {
    total: parseMoney(G('ptot')?.textContent),
    deposit: parseMoney(G('pdep')?.textContent),
    balance: parseMoney(G('pbal')?.textContent),
  }
}

// A short, manufacturer-free description, e.g. "30x50x14 vertical · 2 RU".
export function buildSummary(win, data) {
  const G = win.G
  const v = (id) => {
    const el = G(id)
    return el ? (el.value || el.textContent || '').trim() : ''
  }
  const dims = [v('bw'), v('bl'), v('bh')].filter(Boolean).join('x')
  const roof = (v('rs') || '').toLowerCase()
  const counts = []
  if ((data.doors || []).length) counts.push(`${data.doors.length} RU`)
  if ((data.wtds || []).length) counts.push(`${data.wtds.length} walk-in`)
  if ((data.windows || []).length) counts.push(`${data.windows.length} win`)
  const head = [dims, roof && roof !== '—' ? roof : null].filter(Boolean).join(' ')
  return (head + (counts.length ? ` · ${counts.join(', ')}` : '')).trim() || null
}

// Capture printQuote()'s exact branded HTML *without* opening a popup or
// printing, by intercepting window.open on the same-origin builder window.
// Does not modify the builder or touch its visible UI.
export async function capturePrintHtml(win) {
  if (typeof win.printQuote !== 'function') throw new Error('Builder print function unavailable.')
  let captured = ''   // browser path: printQuote → pwin.document.write(fullDoc)
  let fullDoc = ''    // desktop path: printQuote → _ssSavePdfViaElectron(fullDoc, …)
  const origOpen = win.open
  const origSave = win._ssSavePdfViaElectron
  const fakeWin = {
    closed: false,
    focus() {},
    print() {},
    document: { open() {}, close() {}, write(html) { captured += html } },
  }
  win.open = function () { return fakeWin }
  // In the desktop app, printQuote sends the finished document to Electron via
  // _ssSavePdfViaElectron(fullDoc,…) and SKIPS document.write — so our window
  // capture would only see the "Generating quote…" placeholder (→ blank PDF).
  // Intercept it: grab fullDoc and return true so printQuote treats it as
  // handled (no real save dialog, no double-print).
  win._ssSavePdfViaElectron = function (doc) { fullDoc = doc || ''; return true }
  // printQuote is async and captures the live 3D via window.parent.__ssCapture3D.
  // Force '3d' so the saved PDF uses the CURRENT 3D renderings (printQuote falls
  // back to 2D elevations on its own if the 3D capture ever fails).
  let prevMode
  try {
    const sel = typeof win.G === 'function' ? win.G('pdf-render') : null
    if (sel) { prevMode = sel.value; sel.value = '3d' }
    await win.printQuote()
  } finally {
    win.open = origOpen
    win._ssSavePdfViaElectron = origSave
    const sel = typeof win.G === 'function' ? win.G('pdf-render') : null
    if (sel && prevMode !== undefined) sel.value = prevMode
  }
  if (fullDoc) return fullDoc
  // Browser fallback: captured may hold the placeholder + the real doc — take the
  // last complete <html> document.
  const docs = captured.match(/<!doctype[\s\S]*?<\/html>/gi)
  return docs && docs.length ? docs[docs.length - 1] : captured
}

// Capture printContract()'s branded contract HTML the same silent way as
// capturePrintHtml — intercept window.open + the Electron save hook so no popup
// opens and nothing prints; just return the finished document string. Lets us
// save a contract PDF to the Document Hub without disturbing the builder.
export async function captureContractHtml(win) {
  if (typeof win.printContract !== 'function') throw new Error('Builder contract function unavailable.')
  let captured = ''
  let fullDoc = ''
  const origOpen = win.open
  const origSave = win._ssSavePdfViaElectron
  const fakeWin = {
    closed: false, focus() {}, print() {},
    document: { open() {}, close() {}, write(html) { captured += html } },
  }
  win.open = function () { return fakeWin }
  win._ssSavePdfViaElectron = function (doc) { fullDoc = doc || ''; return true }
  let prevMode
  try {
    const sel = typeof win.G === 'function' ? win.G('pdf-render') : null
    if (sel) { prevMode = sel.value; sel.value = '3d' }
    await win.printContract()
  } finally {
    win.open = origOpen
    win._ssSavePdfViaElectron = origSave
    const sel = typeof win.G === 'function' ? win.G('pdf-render') : null
    if (sel && prevMode !== undefined) sel.value = prevMode
  }
  if (fullDoc) return fullDoc
  const docs = captured.match(/<!doctype[\s\S]*?<\/html>/gi)
  return docs && docs.length ? docs[docs.length - 1] : captured
}

// Downscale a (possibly large, hi-res) image data URL to a small JPEG data URL
// suitable for storing on a quote row and showing as a card thumbnail.
export function dataUrlToThumb(dataUrl, maxW = 520, quality = 0.72) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(null)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW))
        const w = Math.round((img.naturalWidth || maxW) * scale)
        const h = Math.round((img.naturalHeight || maxW) * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#0d1825'; ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', quality))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

// The builder stamps an "SS-YYYY-NNNNN" number into the printed quote. Reusing
// it as quotes.quote_number keeps the DB row and the PDF in lockstep.
export function quoteNumberFromHtml(html) {
  const m = html && html.match(/SS-\d{4}-\d{5}/)
  return m ? m[0] : null
}

// Rasterize the captured print HTML to a real PDF Blob. Renders offscreen in
// the parent document (the print HTML is a full document; we lift its <style>
// + <body> into a container so html2pdf can paginate it).
export async function htmlToPdfBlob(fullHtml) {
  if (!fullHtml) throw new Error('No quote document to render.')
  const doc = new DOMParser().parseFromString(fullHtml, 'text/html')

  // The branded quote's .qpg is min-width:900px, so the capture surface must be
  // at least that wide or html2canvas clips the right edge.
  const CAPTURE_WIDTH = 960

  const container = document.createElement('div')
  // IMPORTANT: do NOT park this with `position:fixed; left:-10000px`. html2canvas
  // renders fixed / off-viewport elements as an empty canvas — that produced a
  // blank PDF. Render it in normal flow at real (0,0) coordinates, sent to the
  // back (negative z-index) and made non-interactive, then removed after capture.
  container.style.cssText =
    `position:absolute;left:0;top:0;width:${CAPTURE_WIDTH}px;` +
    'z-index:-2147483647;pointer-events:none;background:#fff'
  doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => container.appendChild(el.cloneNode(true)))
  const body = document.createElement('div')
  body.innerHTML = doc.body ? doc.body.innerHTML : fullHtml
  container.appendChild(body)
  document.body.appendChild(container)

  try {
    // Let fonts/images settle before rasterizing.
    await new Promise((r) => setTimeout(r, 450))
    const html2pdf = (await import('html2pdf.js')).default
    return await html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        image: { type: 'jpeg', quality: 0.96 },
        // Pin the capture viewport to the container so the full quote width is
        // rasterized from the top-left, not the live (scrolled) window.
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          width: CAPTURE_WIDTH,
          windowWidth: CAPTURE_WIDTH,
          scrollX: 0,
          scrollY: 0,
          x: 0,
          y: 0,
        },
        jsPDF: { unit: 'pt', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(container)
      .outputPdf('blob')
  } finally {
    document.body.removeChild(container)
  }
}
