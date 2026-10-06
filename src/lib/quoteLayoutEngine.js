// quoteLayoutEngine: reads a saved quote's building + EVERY opening exactly as
// the quote program lays it out, for Open Layout (LayoutSheetModal).
//
// The quote program (public/build/quote-builder.html — the same program the
// builder reopens quotes in) is loaded in a hidden, throw-away iframe, the quote
// is restored with its own restoreQuoteData(), and its own collectElevItems()
// returns every opening's spot on the 1/8" grid — the exact numbers its spacing
// page / elevations / contract plan print (incl. Auto-spaced openings and the
// no-overlap model's moves). Nothing is saved, priced or written anywhere; the
// frame is removed afterwards. Same pattern as revisionPricing.js.
//
// Mapping into the layout's coordinates is pure: layoutFromQuote.js.

import { cleanLabel } from './layoutFromQuote'

const PROGRAM_SRC = '/build/quote-builder.html'

function waitFor(test, { timeoutMs = 30000, every = 150 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      let v = null
      try { v = test() } catch { /* keep polling */ }
      if (v) { resolve(v); return }
      if (Date.now() - t0 > timeoutMs) { reject(new Error('The quote program did not load in time.')); return }
      setTimeout(tick, every)
    }
    tick()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Restore `payload` (payload_json) in a hidden program frame and read the raw
 * layout data. Resolves { fields, mfr, W, L, H, pitch, wind, trussOC, colors,
 * elev, labels, leanTos, partitionLabel }. Rejects if the program can't load.
 */
export async function readQuoteForLayout(payload, { timeoutMs = 30000 } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  // Real size (off-screen), so any layout-dependent code behaves as in the builder.
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none'
  frame.src = PROGRAM_SRC
  document.body.appendChild(frame)
  try {
    const pg = await waitFor(() => {
      const w = frame.contentWindow
      return (w && w.document && w.document.readyState === 'complete' && typeof w.restoreQuoteData === 'function' &&
        typeof w.collectElevItems === 'function' && w.PriceLock) ? w : null
    }, { timeoutMs })
    // Never let a dialog in the hidden program block the CRM.
    try { pg.alert = () => {}; pg.confirm = () => false; pg.prompt = () => null } catch { /* ignore */ }
    pg.restoreQuoteData(payload)
    // The restore finishes a few follow-ups on timers (overlap model, labels).
    await sleep(700)
    return extract(pg)
  } finally {
    frame.remove()
  }
}

/** Read everything the layout needs from a restored program window. */
export function extract(pg) {
  const d = pg.document
  const G = (id) => d.getElementById(id)
  const val = (el, cls) => { const f = el.querySelector('.' + cls); return f ? f.value : '' }
  const optText = (sel) => (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].text : ''
  const elev = pg.collectElevItems()

  // Labels per wall, in collectElevItems' own order (.re, .we, .ne, framed .ace;
  // same wall dispatch and quantity), so item i on a wall = label i.
  const partOnFront = (G('btype') || {}).value === 'gch'
  const wallOf = (loc) => (loc === 'Front Gable End' || (loc === 'Partition Wall' && partOnFront)) ? 'front'
    : loc === 'Partition Wall' ? 'partition' : loc === 'Back Gable End' ? 'back'
      : loc === 'Left Eave Side' ? 'left' : loc === 'Right Eave Side' ? 'right' : null
  const labels = { front: [], back: [], left: [], right: [], partition: [] }
  const push = (loc, qty, lab) => { const k = wallOf(loc); if (!k) return; for (let i = 0; i < qty; i++) labels[k].push(lab) }
  d.querySelectorAll('.re').forEach((el) => {
    const dt = el.querySelector('.rdtype')
    const note = dt && dt.value && dt.value !== 'rollup' ? cleanLabel(optText(dt)) : ''
    push(val(el, 'rloc'), parseInt(val(el, 'rqt')) || 1, { note })
  })
  d.querySelectorAll('.we').forEach((el) => push(val(el, 'wloc'), parseInt(val(el, 'wqt')) || 1, { note: cleanLabel(optText(el.querySelector('.whi'))) }))
  d.querySelectorAll('.ne').forEach((el) => push(val(el, 'nloc'), parseInt(val(el, 'nqt')) || 1, { note: cleanLabel(optText(el.querySelector('.ntp'))) }))
  d.querySelectorAll('.ace').forEach((el) => {
    const comp = val(el, 'act'); if (comp.indexOf('Framed Opening') < 0) return
    const locRow = el.querySelector('.fo-loc-row'); if (!locRow || locRow.classList.contains('hidden')) return
    push(val(el, 'fo-loc'), parseInt(val(el, 'acq')) || 1, { comp, note: '' })
  })

  const colors = {}
  for (const id of ['cr', 'cw', 'ct', 'cwn']) {
    const sel = G(id)
    colors[id] = { name: optText(sel).replace(/\s*\(.*\)\s*$/, '').trim(), hex: sel ? sel.value : '' }
  }
  const W = parseInt((G('bw') || {}).value) || 0
  const L = parseInt((G('bl') || {}).value) || 0
  const H = parseFloat((G('bh') || {}).value) || 0
  let trussOC = null
  try { trussOC = pg.getTrussOC() } catch { /* fallback in layoutFromQuote */ }
  const wind = parseInt(((G('cert-req') || {}).textContent || '').replace(/[^\d]/g, '')) || null
  const pitch = ((G('pitch') || {}).textContent || '').trim()

  // Attached lean-tos (the layout can't draw them -> sheet notes).
  let leanTos = []
  try {
    if (typeof pg._dimLeanTos === 'function') {
      leanTos = pg._dimLeanTos(W, L, H).map((l) => {
        const accs = []
        l.el.querySelectorAll('.lt-acc-e').forEach((ae) => {
          const t = cleanLabel(optText(ae.querySelector('.lt-acc-type')))
          const q = parseInt(val(ae, 'lt-acc-qty')) || 1
          const sz = val(ae, 'lt-acc-size')
          if (t) accs.push(`${q}× ${t}${sz && /^\d+x\d+$/i.test(sz) ? ' ' + sz : ''}`)
        })
        return { n: l.n, side: l.side, w: l.w, low: l.low, len: l.len, start: l.start, stor: l.stor ? { end: l.stor.end, len: l.stor.len } : null, openings: accs.join(', ') }
      })
    }
  } catch { leanTos = [] }

  let partitionLabel = ''
  const aew = G('add-end-wall')
  if (aew && aew.value && aew.value !== 'no') {
    partitionLabel = cleanLabel(optText(aew)).replace(/\s*—\s*/g, ' — ')
    if (aew.value === 'yes' && G('aew-end')) partitionLabel += `, ${G('aew-end').value} end`
  }

  let fields = {}
  try { fields = pg.collectQuoteData().fields || {} } catch { /* use what we have */ }
  return {
    fields, mfr: pg.ACTIVE_MFR || '', W, L, H, pitch, wind, trussOC, colors,
    elev: { front: elev.front, back: elev.back, right: elev.right, left: elev.left, partition: elev.partition, W: elev.W, L: elev.L },
    labels, leanTos, partitionLabel,
  }
}
