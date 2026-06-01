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
export function capturePrintHtml(win) {
  if (typeof win.printQuote !== 'function') throw new Error('Builder print function unavailable.')
  let captured = ''
  const origOpen = win.open
  const fakeWin = {
    closed: false,
    focus() {},
    print() {},
    document: { open() {}, close() {}, write(html) { captured += html } },
  }
  win.open = function () { return fakeWin }
  try {
    win.printQuote()
  } finally {
    win.open = origOpen
  }
  return captured
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
