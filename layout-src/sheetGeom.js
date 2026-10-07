/* ============================================================
   sheetGeom.js — pure geometry for the paginated Approval Sheet
   (owner 10/6/26: "should look more like ... the 2d spacing layout").

   No DOM, no React: imported by SheetDoc.jsx (bundled by esbuild into
   public/layout/SheetDoc.js) and by the unit tests (tests/sheetGeom.test.mjs).

   Every length is decimal FEET in, and every number that prints is worked
   on the quote program's 1/8″ grid (integer eighths, `e8`), so a wall's chain
   (end gaps + opening widths + gaps) adds up to the wall exactly and equals
   the program's spacing page (quote-builder dimElevSVG: stops at 0, every
   opening edge, the wall end; every gap down to 1/8″).

   FRAMES — each elevation is drawn in the SAME frame as the program's
   spacing page card for that wall (x = ft from the drawing's left end):
     front      x from the LEFT eave corner        ends LEFT EAVE · RIGHT EAVE
     back       x from the RIGHT eave corner       ends RIGHT EAVE · LEFT EAVE  (seen from behind)
     right eave x from the FRONT gable             ends FRONT GABLE · BACK GABLE
     left eave  x from the BACK gable              ends BACK GABLE · FRONT GABLE
     partition  x from the left, seen from the front (GCH divider / End Storage)
   The layout stores `offset` from WALLS.ref (data.js): front / back / divider
   from the LEFT eave corner, left / right eaves from the BACK gable — the
   inverse of layoutFromQuote.layoutOffset.
   Lean-to walls use the program's own lean-to frames (ltAccXs / ltPartLayout:
   outer wall from the run start, end walls + storage partition from the
   lower across-coordinate — the 3D's minA), drawn as noted per wall below.
   ============================================================ */

export const EIGHTHS = 96 // 1/8″ steps per foot

// Print-first type sizes (drawing px ~ 1 CSS px on an 816 px letter page; the CRM PDF prints
// ~0.61 pt per px, window.print 0.75 pt per px): dimension numbers >= ~9 pt, W×H / sill 10–11 pt.
export const FS = { chain: 14.5, size: 16, sill: 14.5, end: 12.5, total: 19, tag: 13.5, peak: 14, leg: 15.5, frame: 13, lt: 14 }

/** decimal feet -> integer eighths of an inch (the program's dimQ grid). */
export function e8(ft) {
  const v = Math.round(Number(ft) * EIGHTHS)
  return v === 0 || !isFinite(v) ? 0 : v
}

const FRAC = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
/**
 * THE sheet formatter (same algorithm as data.js ftInTight — the tests hold
 * them equal): feet-inches to the nearest 1/8″, the fraction as a glyph,
 * never decimals. 8.9792 -> 8′11¾″ · 3.0208 -> 3′0¼″ · 6.67 -> 6′8″ · 30 -> 30′.
 */
export function fmtFtIn(ft) {
  if (ft == null || isNaN(ft)) return '—'
  const e = e8(ft), a = Math.abs(e)
  const f = Math.floor(a / 96), r = a - f * 96
  return (e < 0 ? '−' : '') + (r ? `${f}′${Math.floor(r / 8)}${FRAC[r % 8]}″` : `${f}′`)
}
/** eighths -> feet-inches text */
export const fmt8 = (n) => fmtFtIn(n / EIGHTHS)

// ── the dimension chain ─────────────────────────────────────────────────────
/**
 * The program's chain for one wall: stops at 0, every opening's two edges and
 * the wall end; consecutive stops make the segments; a segment covered by an
 * opening is that opening's WIDTH, any other is a GAP. Eighths in and out.
 * items: [{x, w}] in feet (the wall's own frame). Returns [] with no items
 * (the program draws no chain then — only the overall).
 */
export function chain(items, faceW) {
  const list = (items || []).filter((it) => it && isFinite(it.x) && isFinite(it.w))
  if (!list.length) return []
  const F = e8(faceW)
  const spans = list.map((it) => [e8(it.x), e8(it.x) + e8(it.w)])
  const stops = Array.from(new Set([0, F, ...spans.flat()])).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1]
    if (b - a < 1) continue
    const inside = spans.some(([s, t]) => s <= a && t >= b)
    out.push({ a, b, d: b - a, kind: inside ? 'width' : 'gap' })
  }
  return out
}

/**
 * Place chain labels on rows: gaps on row 0 (above the dimension line),
 * opening widths on row 1 (below it). A label that would touch the previous
 * one on its row drops to an extra row (gaps: 2, widths: 3) — every number is
 * printed, nothing overlaps. px(ftEighths) maps to drawing x; charW = px per
 * character at the label size.
 */
export function chainRows(segs, px, charW = FS.chain * 0.56) {
  // rows: 0 = above the line (gaps), 1 = right below it (widths), 2.. = further down.
  // Every label takes the first row where it touches nothing (no overlaps, ever).
  const last = []
  const order = (kind) => (kind === 'gap' ? [0, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7])
  return segs.map((sg) => {
    const text = fmt8(sg.d)
    const cx = (px(sg.a) + px(sg.b)) / 2
    const half = (text.length * charW) / 2 + 3
    const row = order(sg.kind).find((r) => !(cx - half < (last[r] == null ? -1e9 : last[r]) + 4))
    const use = row == null ? 8 : row
    last[use] = cx + half
    return { ...sg, text, cx, row: use }
  })
}

// ── layout openings -> program frames ──────────────────────────────────────
/** Program-frame x (feet, on the 1/8″ grid) of a layout opening on its wall. */
export function frameX(op, W, L) {
  const off = e8(op.offset), w = e8(op.w)
  if (op.wall === 'back') return (e8(W) - off - w) / EIGHTHS
  if (op.wall === 'right') return (e8(L) - off - w) / EIGHTHS
  return off / EIGHTHS // front, left, divider
}

const ROLE = { rollup: 'rollup', walk: 'walk', double: 'walk', window: 'window', sliding: 'rollup', framed: 'framed', custom: 'framed' }
function item(op, x, extra) {
  return {
    x, w: e8(op.w) / EIGHTHS, h: e8(op.h) / EIGHTHS, sill: e8(op.sill || 0) / EIGHTHS,
    type: op.type, role: ROLE[op.type] || 'framed', id: op.id, ...extra,
  }
}

function parsePitchNum(p) {
  if (p == null) return 0
  if (typeof p === 'number') return p / 12
  const m = String(p).split(/[:/]/)
  const rise = parseFloat(m[0]), run = parseFloat(m[1] != null ? m[1] : '12')
  return isFinite(rise) && isFinite(run) && run ? rise / run : 0
}

/** Frame lines (ft from the FRONT gable, interior only). geom.truss wins (the program's own). */
export function trussFromFront(building, geom) {
  const L = Number(building.length) || 0
  if (geom && Array.isArray(geom.truss) && geom.truss.length) return geom.truss.filter((t) => t > 0 && t < L)
  const oc = Number(building.trussOC) || 0
  const out = []
  if (oc > 0) for (let t = oc; t < L - 1e-6; t += oc) out.push(t)
  return out
}

function ltRect(l, W, L) {
  if (l.k === 'left') return { z0: l.start, z1: l.start + l.len, x0: -l.w, x1: 0 }
  if (l.k === 'right') return { z0: l.start, z1: l.start + l.len, x0: W, x1: W + l.w }
  if (l.k === 'front') return { z0: -l.w, z1: 0, x0: l.start, x1: l.start + l.len }
  return { z0: L, z1: L + l.w, x0: W - l.start - l.len, x1: W - l.start }
}
export { ltRect }

/**
 * Plan span of one lean-to opening. Plan coords: z = ft from the FRONT gable
 * (along the length), x = ft from the LEFT eave (across; negative = past the
 * left eave). Returns {z0,z1,x0,x1} (one pair equal = the wall line).
 * `x` = the program's left edge in the wall's own frame (ltAccXs / ltPartLayout).
 */
export function ltOpeningPlan(l, loc, x, w, W, L) {
  const r = ltRect(l, W, L)
  const eave = l.k === 'left' || l.k === 'right'
  if (loc === 'outer') {
    if (eave) { const xx = l.k === 'left' ? -l.w : W + l.w; return { z0: l.start + x, z1: l.start + x + w, x0: xx, x1: xx } }
    const zz = l.k === 'front' ? -l.w : L + l.w
    return { z0: zz, z1: zz, x0: r.x1 - x - w, x1: r.x1 - x }
  }
  // end walls + storage partition: across = the lower world coordinate + x (3D minA)
  let at
  if (eave) at = loc === 'front' ? r.z0 : loc === 'back' ? r.z1 : (l.stor ? l.stor.at : r.z0)
  else at = loc === 'front' ? r.x1 : loc === 'back' ? r.x0 : (l.stor ? (l.k === 'back' ? W - l.stor.at : l.stor.at) : r.x0)
  if (l.k === 'left') return { z0: at, z1: at, x0: -(x + w), x1: -x }
  if (l.k === 'right') return { z0: at, z1: at, x0: W + l.w - x - w, x1: W + l.w - x }
  if (l.k === 'front') return { z0: -l.w + x, z1: -l.w + x + w, x0: at, x1: at }
  return { z0: L + x, z1: L + x + w, x0: at, x1: at }
}

// ── elevation specs ────────────────────────────────────────────────────────
const SIDE_LT_NAME = { left: 'Left eave', right: 'Right eave', front: 'Front gable', back: 'Back gable' }

/**
 * Every elevation the sheet draws, in the program's card order: Front, Back,
 * partitions, Right eave, Left eave, then each lean-to's walls. Only walls
 * that carry openings (or a lean-to opening whose spot the program doesn't
 * have — listed "position TBD"). Each spec:
 *   { key, title, sub, faceW, h(x)->wall height, eave, peak, gable, items[],
 *     ends:[l,r], truss[], oc, open, foot[], side[], notes[], tags }
 * building: the layout's building (width/length/height/pitch/config/trussOC);
 * openings: layout openings; geom: the quote's extra geometry (seed `geom`).
 */
export function elevationSpecs(building, openings, geom, tagMap = {}, opts = {}) {
  const W = Number(building.width) || 0, L = Number(building.length) || 0, H = Number(building.height) || 0
  const pitch = parsePitchNum(building.pitch)
  const peak = H + (W / 2) * pitch
  const gableH = (x) => H + Math.min(Math.max(x, 0), Math.max(W - x, 0)) * pitch
  const flatH = () => H
  const g = geom && geom.W === W && geom.L === L ? geom : null // geometry only while the size matches the quote
  const lts = g && Array.isArray(g.leanTos) ? g.leanTos : []
  const eaveLTs = lts.filter((l) => l.k === 'left' || l.k === 'right')
  const gableLTs = lts.filter((l) => l.k === 'front' || l.k === 'back')
  const open = (g && g.open) || {}
  const hybrid = building.config === 'hybrid'
  const carport = building.config === 'carport'
  const ops = (openings || []).filter((o) => o && isFinite(o.offset) && o.w > 0)
  const on = (wall) => ops.filter((o) => o.wall === wall).map((o) => item(o, frameX(o, W, L), { tag: tagMap[o.id] }))
  const tFront = trussFromFront(building, g)
  const oc = (g && g.oc) || Number(building.trussOC) || 0
  const out = []
  // opts.all (the Edit view): every main wall that can carry an opening is drawn, so
  // openings can be dragged / placed on it; lean-to walls only when they have openings.
  const push = (spec) => { if (spec.items.length || (spec.notes && spec.notes.length) || (opts.all && spec.wall && !spec.open)) out.push(spec) }
  const ltFoot = (l, x0) => ({ x0, len: l.len, h: l.conn, label: `LT${l.n} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} lean-to` })
  const ltSide = (l, onLeft) => ({ onLeft, w: l.w, low: l.low, conn: l.conn, label: `LT${l.n}` })

  // gable views (as you stand outside facing the wall)
  const frontOpen = hybrid ? building.openEnd === 'front' : (carport || !!open.front)
  const backOpen = hybrid ? building.openEnd === 'back' : (carport || !!open.back)
  push({
    key: 'front', wall: 'front', title: 'Front gable', sub: 'seen from the front', faceW: W, gable: true, eave: H, peak, h: gableH,
    items: on('front'), ends: ['LEFT EAVE', 'RIGHT EAVE'], truss: [], oc: 0, open: frontOpen,
    side: eaveLTs.map((l) => ltSide(l, l.k === 'left')), foot: gableLTs.filter((l) => l.k === 'front').map((l) => ltFoot(l, l.start)),
  })
  push({
    key: 'back', wall: 'back', title: 'Back gable', sub: 'seen from behind', faceW: W, gable: true, eave: H, peak, h: gableH,
    items: on('back'), ends: ['RIGHT EAVE', 'LEFT EAVE'], truss: [], oc: 0, open: backOpen,
    side: eaveLTs.map((l) => ltSide(l, l.k === 'right')), foot: gableLTs.filter((l) => l.k === 'back').map((l) => ltFoot(l, l.start)),
  })
  if (hybrid) {
    push({
      key: 'divider', wall: 'divider', title: 'Partition wall', sub: 'enclosed bay · seen from the front', faceW: W, gable: true, eave: H, peak, h: gableH,
      items: on('divider'), ends: ['LEFT EAVE', 'RIGHT EAVE'], truss: [], oc: 0, open: false, side: [], foot: [],
    })
  }
  if (g && g.partition && Array.isArray(g.partition.items) && g.partition.items.length) {
    const p = g.partition
    push({
      key: 'partition', title: 'Storage partition (interior)', sub: `${fmtFtIn(p.depth)} from the ${p.end} end · seen from the front`,
      faceW: W, gable: true, eave: H, peak, h: gableH,
      items: p.items.map((it, i) => ({ x: e8(it.x) / 96, w: e8(it.w) / 96, h: e8(it.h || it.w) / 96, sill: e8(it.yo || 0) / 96, type: it.type, role: progRole(it.type), id: 'p' + i })),
      ends: ['LEFT EAVE', 'RIGHT EAVE'], truss: [], oc: 0, open: false, side: [], foot: [],
    })
  }
  // eave views: Right Eave x from the FRONT, Left Eave x from the BACK
  push({
    key: 'right', wall: 'right', title: 'Right eave', sub: 'seen from outside', faceW: L, gable: false, eave: H, peak: H, h: flatH,
    items: on('right'), ends: ['FRONT GABLE', 'BACK GABLE'], truss: tFront, oc, open: carport || !!open.right,
    side: gableLTs.map((l) => ltSide(l, l.k === 'front')), foot: eaveLTs.filter((l) => l.k === 'right').map((l) => ltFoot(l, l.start)),
  })
  push({
    key: 'left', wall: 'left', title: 'Left eave', sub: 'seen from outside', faceW: L, gable: false, eave: H, peak: H, h: flatH,
    items: on('left'), ends: ['BACK GABLE', 'FRONT GABLE'], truss: tFront.map((t) => L - t), oc, open: carport || !!open.left,
    side: gableLTs.map((l) => ltSide(l, l.k === 'back')), foot: eaveLTs.filter((l) => l.k === 'left').map((l) => ltFoot(l, L - l.start - l.len)),
  })
  lts.forEach((l) => leanToSpecs(l, tFront, oc).forEach(push))
  return out
}

function progRole(t) { return t === 'rollup' ? 'rollup' : t === 'wtd' ? 'walk' : t === 'win' ? 'window' : 'framed' }

/** Lean-to wall height at x on an end wall / partition (the program's ltPartWallH). */
export function ltWallH(part, x) {
  const d = part.lowAtZero ? x : part.len - x
  return part.low + Math.max(0, Math.min(part.len, d)) * part.slope
}

/**
 * The walls of one lean-to that carry openings. Outer wall: the lean-to's
 * long wall at its low eave, frame lines where the lean-to's bents sit (the
 * main building's frame lines inside its run), drawn like the main eave /
 * gable it runs along (left-eave and front-gable lean-tos mirrored so the
 * ends read the same way as the main wall's card). End walls + storage
 * partition: the sloped bent profile, x from the program's own end
 * (OUTER POST / MAIN WALL named on the chain), exactly as the program's
 * "Storage Partition" card draws them.
 */
export function leanToSpecs(l, tFront = [], oc = 0) {
  const eave = l.k === 'left' || l.k === 'right'
  const part = l.part || { len: l.w, low: l.low, slope: (l.pitch || 0) / 12, lowAtZero: l.k === 'right' || l.k === 'front' }
  const mirror = l.k === 'left' || l.k === 'front' // outer wall drawn seen from outside
  const byLoc = { outer: [], front: [], back: [], partition: [] }
  const tbd = { outer: [], front: [], back: [], partition: [] }
  ;(l.openings || []).forEach((o, oi) => {
    const loc = byLoc[o.loc] ? o.loc : 'outer'
    const w = e8(o.w) / 96, h = e8(o.h) / 96, sill = e8(o.sill || 0) / 96
    const ok = Array.isArray(o.xs) && o.xs.length === (o.qty || o.xs.length) && o.xs.every((v) => isFinite(v)) && w > 0
    const name = o.label || ({ rollup: 'Roll-up door', wtd: 'Walk door', win: 'Window', fo: 'Framed opening' }[o.type] || 'Opening')
    if (!ok) {
      tbd[loc].push(`${o.qty > 1 ? o.qty + '× ' : ''}${name}${w > 0 ? ' ' + fmtFtIn(w) + ' × ' + fmtFtIn(h) : ''} — position TBD (the quote has no spot for it)`)
      return
    }
    o.xs.forEach((x0, i) => {
      const x = e8(x0) / 96
      const run = loc === 'outer' ? l.len : part.len
      const xd = loc === 'outer' && mirror ? (e8(run) - e8(x) - e8(w)) / 96 : x
      byLoc[loc].push({ x: xd, w, h, sill, type: o.type, role: progRole(o.type), id: `lt${l.n}-${oi}-${i}`, name,
        lt: { n: l.n, oi, i, run, mirror: loc === 'outer' && mirror } })
    })
  })
  const specs = []
  const lt = `Lean-to ${l.n}`
  const where = `${SIDE_LT_NAME[l.k]} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} · ${fmtFtIn(l.low)} low eave`
  // outer wall
  const runEnds = eave
    ? (l.k === 'left' ? ['BACK END', 'FRONT END'] : ['FRONT END', 'BACK END'])
    : (l.k === 'front' ? ['LEFT EAVE END', 'RIGHT EAVE END'] : ['RIGHT EAVE END', 'LEFT EAVE END'])
  let truss = []
  if (eave) {
    truss = tFront.filter((t) => t > l.start + 1e-6 && t < l.start + l.len - 1e-6).map((t) => (mirror ? l.start + l.len - t : t - l.start))
  }
  let storX = null
  if (l.stor && eave) storX = mirror ? l.start + l.len - l.stor.at : l.stor.at - l.start
  specs.push({
    key: `lt${l.n}-outer`, lt: l.n, title: `${lt} · outer wall`, sub: where, faceW: l.len, gable: false, eave: l.low, peak: l.low,
    h: () => l.low, items: byLoc.outer, ends: runEnds, truss, oc: eave ? oc : 0, open: l.walls ? l.walls.side !== 'closed' : false,
    side: [], foot: [], storX, notes: tbd.outer,
  })
  const ends = part.lowAtZero ? ['OUTER POST', 'MAIN WALL'] : ['MAIN WALL', 'OUTER POST']
  const endName = eave ? { front: 'front end wall', back: 'back end wall' } : { front: 'right-eave end wall', back: 'left-eave end wall' }
  for (const loc of ['front', 'back']) {
    specs.push({
      key: `lt${l.n}-${loc}`, lt: l.n, title: `${lt} · ${endName[loc]}`, sub: where, faceW: part.len, gable: false, sloped: true,
      eave: part.low, peak: Math.max(ltWallH(part, 0), ltWallH(part, part.len)), h: (x) => ltWallH(part, x),
      items: byLoc[loc], ends, truss: [], oc: 0, open: l.walls ? l.walls[loc] !== 'closed' : false, side: [], foot: [], notes: tbd[loc],
    })
  }
  if (l.stor) {
    specs.push({
      key: `lt${l.n}-partition`, lt: l.n, title: `${lt} · storage partition`, sub: `${fmtFtIn(l.stor.len)} storage at the ${l.stor.end} end · ${SIDE_LT_NAME[l.k]}`,
      faceW: part.len, gable: false, sloped: true, eave: part.low, peak: Math.max(ltWallH(part, 0), ltWallH(part, part.len)),
      h: (x) => ltWallH(part, x), items: byLoc.partition, ends, truss: [], oc: 0, open: false, side: [], foot: [], notes: tbd.partition,
    })
  } else if (tbd.partition.length) {
    specs[0].notes = specs[0].notes.concat(tbd.partition)
  }
  return specs
}

// ── drawing geometry for one elevation ─────────────────────────────────────
/**
 * Pixel layout of one elevation in a VW-wide viewBox: scale, origin, ground
 * line, chain + overall rows, total height. maxH caps the drawn wall height so
 * two or three elevations fit a letter page.
 */
export function elevLayout(spec, { VW = 740, maxH = 230, mL = 34, mR = 104, mT = 42 } = {}) {
  let extL = 0, extR = 0
  ;(spec.side || []).forEach((q) => { if (q.onLeft) extL = Math.max(extL, q.w); else extR = Math.max(extR, q.w) })
  ;(spec.items || []).forEach((it) => { extL = Math.max(extL, -it.x); extR = Math.max(extR, it.x + it.w - spec.faceW) })
  const span = spec.faceW + extL + extR
  const top = Math.max(spec.peak || 0, spec.eave || 0, 1)
  const s = Math.min((VW - mL - mR) / (span || 1), maxH / top)
  const ox = mL + ((VW - mL - mR) - span * s) / 2 + extL * s
  const gy = mT + top * s
  const segs = chain(spec.items, spec.faceW)
  const X = (ft) => ox + ft * s
  const rows = chainRows(segs, (n) => X(n / EIGHTHS))
  const usedRows = rows.reduce((m, r) => Math.max(m, r.row), -1)
  const dy = gy + 28 // the chain's dimension line
  const step = FS.chain + 3.5
  const rowY = (row) => (row === 0 ? dy - 7 : dy + 4 + step * row - 3.5)
  const dy2 = segs.length ? rowY(Math.max(1, usedRows)) + 24 : gy + 30 // overall dimension line
  const VH = Math.round(dy2 + FS.end + 20)
  return { s, ox, gy, dy, dy2, VH, VW, X, Y: (h) => gy - h * s, rows, rowY, segs, extL, extR }
}

// ── pagination ─────────────────────────────────────────────────────────────
/**
 * Pack blocks into letter pages. heights: elevation card heights (px), in
 * order; avail: usable px on an elevation page; signH: the approval block;
 * maxPer: cards per page (2–3). Returns pages as arrays of block indexes; the
 * approval goes on the last page ('sign'), on a page of its own only when it
 * can't fit under the last cards. p1Sign: true when there are no elevations
 * and the approval fits on page 1.
 */
export function paginate(heights, avail, signH, maxPer = 3, p1Room = 0) {
  const pages = []
  let cur = [], used = 0
  heights.forEach((h, i) => {
    if (cur.length && (cur.length >= maxPer || used + h > avail)) { pages.push(cur); cur = []; used = 0 }
    cur.push(i); used += h
  })
  if (cur.length) pages.push(cur)
  if (!pages.length) {
    if (signH <= p1Room) return { pages: [], signOnP1: true }
    return { pages: [['sign']], signOnP1: false }
  }
  const last = pages[pages.length - 1]
  const lastUsed = last.reduce((t, i) => t + heights[i], 0)
  if (lastUsed + signH <= avail) last.push('sign')
  else if (last.length >= 2 && heights[last[last.length - 1]] + signH <= avail) pages.push([last.pop(), 'sign']) // never an approval page on its own
  else pages.push(['sign'])
  return { pages, signOnP1: false }
}

// ── editing (the Edit view: drag on the plan / elevations, arrow keys) ──────
/** Layout offset (WALLS.ref corner) of an opening whose left edge is `x` in its elevation frame (inverse of frameX). */
export function offsetFromFrameX(wall, x, w, W, L) {
  const ex = e8(x), ew = e8(w)
  if (wall === 'back') return (e8(W) - ex - ew) / EIGHTHS
  if (wall === 'right') return (e8(L) - ex - ew) / EIGHTHS
  return ex / EIGHTHS
}
/** Elevation-drawing x of a lean-to item -> the program's own x (ltAccXs / ltPartLayout frame), and back (same map). */
export function ltDrawToProg(ref, x, w) { return ref && ref.mirror ? (e8(ref.run) - e8(x) - e8(w)) / EIGHTHS : x }

/**
 * Snap a dragged left edge along a wall (the old plan's rules, one place):
 * the left edge, centre and right edge snap to `lines` (wall ends, wall
 * centre, the 5′ grid, neighbours' edges + centres) within `snap` ft; the
 * CENTRE alone snaps to `centerLines` (frame lines) at half that distance.
 * No snap: the nearest 1″. Always kept on the wall (0 … len − w).
 */
export function snapAlong(raw, w, len, { lines = [], centerLines = [], snap = 0.4, free = false } = {}) {
  const clamp = (v) => Math.max(0, Math.min(Math.max(0, len - w), v))
  if (free) return { x: clamp(Math.round(raw * 12) / 12), guide: null }
  const anchors = [[raw, 0], [raw + w / 2, w / 2], [raw + w, w]]
  let best = null
  lines.forEach((p) => anchors.forEach(([a, k]) => { const d = Math.abs(a - p); if (d < snap && (!best || d < best.d)) best = { d, x: p - k, guide: p } }))
  centerLines.forEach((p) => { const d = Math.abs(raw + w / 2 - p); if (d < snap / 2 && (!best || d < best.d * 0.95)) best = { d, x: p - w / 2, guide: p } })
  if (best) return { x: clamp(best.x), guide: best.guide }
  return { x: clamp(Math.round(raw * 12) / 12), guide: null }
}
/** Snap lines for a wall of length len: ends, centre, 5′ grid, other openings' edges + centres. */
export function wallSnapLines(len, others = []) {
  const out = [0, len, len / 2]
  for (let f = 5; f < len; f += 5) out.push(f)
  others.forEach((o) => { out.push(o.x, o.x + o.w, o.x + o.w / 2) })
  return out
}

/** "lt1-0-2" -> {n:1, oi:0, i:2} (a lean-to opening's id), else null. */
export function parseLtId(id) {
  const m = /^lt(\d+)-(\d+)-(\d+)$/.exec(String(id || ''))
  return m ? { n: +m[1], oi: +m[2], i: +m[3] } : null
}
/** The wall length a lean-to opening slides along (outer: the run; ends / partition: the bent). */
export function ltWallLen(l, loc) { return loc === 'outer' ? l.len : (l.part ? l.part.len : l.w) }
/**
 * geom with one lean-to opening moved to program-frame x (1/8″ grid, kept on
 * its wall). Pure — returns a new geom; unknown ids return geom unchanged.
 */
export function setLtOpeningX(geom, ref, x) {
  if (!geom || !ref || !Array.isArray(geom.leanTos)) return geom
  let hit = false
  const leanTos = geom.leanTos.map((l) => {
    if (l.n !== ref.n) return l
    const openings = (l.openings || []).map((o, oi) => {
      if (oi !== ref.oi || !Array.isArray(o.xs) || ref.i >= o.xs.length) return o
      const len = ltWallLen(l, o.loc)
      const v = e8(Math.max(0, Math.min(Math.max(0, len - o.w), x))) / EIGHTHS
      hit = true
      return { ...o, xs: o.xs.map((xx, k) => (k === ref.i ? v : xx)) }
    })
    return { ...l, openings }
  })
  return hit ? { ...geom, leanTos } : geom
}
/** Current program-frame x of a lean-to opening, or null. */
export function getLtOpening(geom, ref) {
  const l = geom && Array.isArray(geom.leanTos) ? geom.leanTos.find((q) => q.n === ref.n) : null
  const o = l && l.openings ? l.openings[ref.oi] : null
  if (!o || !Array.isArray(o.xs) || !(ref.i < o.xs.length)) return null
  return { l, o, x: o.xs[ref.i] }
}
