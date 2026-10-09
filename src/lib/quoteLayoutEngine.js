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

import { cleanLabel, q8 } from './layoutFromQuote'

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
 * elev, labels, leanTos, partitionLabel, geom }. Rejects if the program can't load.
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

  // Attached lean-tos -> sheet notes (+ drawn from `geom` below).
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
  let geom = null
  try { geom = readGeom(pg, W, L, H, elev) } catch (e) { console.warn('Open Layout: lean-to / frame geometry unreadable', e); geom = null }
  if (geom) leanTos = geom.leanTos.map((l) => ({ ...leanTos.find((x) => x.n === l.n), openingList: l.openings }))
  return {
    fields, mfr: pg.ACTIVE_MFR || '', W, L, H, pitch, wind, trussOC, colors,
    elev: { front: elev.front, back: elev.back, right: elev.right, left: elev.left, partition: elev.partition, W: elev.W, L: elev.L },
    labels, leanTos, partitionLabel, geom,
  }
}

// The quote's extra geometry for the paginated Approval Sheet (sheetGeom.js):
// every attached lean-to as the program's spacing page reads it (_dimLeanTos:
// side, width, run, start, low eave, connection height, storage section +
// partition spot, wall modes), its bent profile (ltPartGeom), and each
// lean-to opening with its size (ltPartDims — the sizes the 3D draws) and the
// program's OWN left edges: ltPartLayout on the storage partition (what the
// spacing page's partition card draws), ltAccXs on the outer / end walls (its
// no-overlap model, the spots the 3D draws). No spot from the program -> xs
// null -> the sheet lists it as "position TBD", never a made-up spot. Also the
// frame lines (getTrussPositions, from the FRONT), the End Storage / lengthwise
// partition (aewSpec, the contract plan's placement) and the open walls.
const LT_TYPE_NAME = { rollup: 'Roll-Up Door', wtd: 'Walk-Through Door', win: 'Window', frameout: 'Framed Opening' }
export function readGeom(pg, W, L, H, elev) {
  const d = pg.document
  const G = (id) => d.getElementById(id)
  const val = (el, cls) => { const f = el.querySelector('.' + cls); return f ? f.value : '' }
  const optText = (sel) => (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].text : ''
  const fin = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
  const lts = typeof pg._dimLeanTos === 'function' ? pg._dimLeanTos(W, L, H) : []
  const leanTos = lts.map((l) => {
    let part = null
    try {
      if (typeof pg.ltPartGeom === 'function') {
        const g = pg.ltPartGeom(l.el)
        part = { len: g.len, low: g.low, slope: g.slope, pitch: g.pitch, lowAtZero: !!g.lowAtZero }
      }
    } catch { part = null }
    const openings = []
    l.el.querySelectorAll('.lt-acc-e').forEach((ae) => {
      const loc = val(ae, 'lt-acc-loc') || 'outer'
      const t = val(ae, 'lt-acc-type') || 'rollup'
      let dm = null
      try { dm = pg.ltPartDims(ae) } catch { dm = null }
      if (!dm) return // the 45° cut is a charge, not an opening
      if (loc === 'partition' && !l.stor) return // no priced storage: the program flags it + blocks printing
      const qty = parseInt(val(ae, 'lt-acc-qty')) || 1
      let xs = null
      try {
        if (loc === 'partition') xs = dm.w > 0 ? pg.ltPartLayout(ae, dm.w) : null
        else if (typeof pg.ltAccXs === 'function') xs = pg.ltAccXs(ae)
      } catch { xs = null }
      if (!Array.isArray(xs) || xs.length !== qty || !xs.every((x) => isFinite(x)) || !(dm.w > 0)) xs = null
      const detailSel = t === 'wtd' ? '.lt-acc-wtd-hi' : t === 'win' ? '.lt-acc-win-hi' : t === 'frameout' ? '.lt-acc-fo-type' : null
      const detail = detailSel ? cleanLabel(optText(ae.querySelector(detailSel))) : ''
      openings.push({
        type: t === 'frameout' ? 'fo' : t, loc, qty, w: q8(dm.w || 0), h: q8(dm.h || 0), sill: q8(dm.sill || 0),
        xs: xs ? xs.map(q8) : null, label: LT_TYPE_NAME[t] || 'Opening', detail,
      })
    })
    const wl = l.walls || {}
    return {
      n: l.n, side: l.side, k: l.k, w: l.w, low: l.low, pitch: l.pitch, conn: fin(l.conn), len: l.len, ll: l.ll, start: l.start,
      stor: l.stor ? { end: l.stor.end, len: l.stor.len, at: l.stor.at } : null,
      walls: { front: wl.front || 'open', back: wl.back || 'open', side: wl.side || 'open', mode: wl.mode || 'open' },
      part, openings,
    }
  })
  let truss = [], oc = 0
  try { const ti = pg.getTrussInfo(); oc = (ti && ti.spacing) || 0 } catch { oc = 0 }
  try { if (oc && typeof pg.getTrussPositions === 'function') truss = pg.getTrussPositions(L).filter((t) => t > 0 && t < L) } catch { truss = [] }
  let partition = null
  try {
    const sp = typeof pg.aewSpec === 'function' ? pg.aewSpec() : null
    if (sp && sp.on && !sp.unset) {
      if (sp.kind === 'end') {
        const dd = Math.min(sp.depthFt, L)
        partition = { kind: 'y', end: sp.end, depth: dd, at: sp.end === 'front' ? dd : L - dd,
          items: (elev.partition || []).map((it) => ({ type: it.type, x: it.x, w: it.w, h: it.h || it.w, yo: it.yo || 0 })) }
      } else {
        const wd = Math.min(sp.widthFt, W)
        partition = { kind: 'x', side: sp.kind, width: wd, at: sp.kind === 'left' ? wd : W - wd }
      }
    }
  } catch { partition = null }
  const gch = (G('btype') || {}).value === 'gch'
  const open = { front: (G('wfg') || {}).value === 'Open', back: (G('wbg') || {}).value === 'Open', left: !gch && (G('wle') || {}).value === 'Open', right: !gch && (G('wre') || {}).value === 'Open' }
  // the program's peak / center clearance (CCI handbook figures, the spacing page's
  // "Peak ≈" + "Center clearance ≈"): ONE definition on both drawings (10/9/26)
  let clr = null
  try {
    const c = typeof pg.cciClearance === 'function' ? pg.cciClearance(W, (G('rs') || {}).value, H) : null
    if (c && isFinite(c.peak) && isFinite(c.center)) clr = { peak: c.peak, center: c.center, to: c.to === 'roof' ? 'roof' : 'truss' }
  } catch { clr = null }
  return { W, L, H, truss, oc, leanTos, partition, open, clr }
}
