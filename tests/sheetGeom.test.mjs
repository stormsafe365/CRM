// Unit tests for the paginated Approval Sheet geometry (layout-src/sheetGeom.js):
// the ONE feet-inches formatter, the elevation frames (layout offsets back to
// the quote program's spacing-page frames), the dimension chain (must equal
// the program's dimElevSVG chain), lean-to elevations + plan spots, the
// drawing layout and the pagination. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import {
  e8, fmtFtIn, chain, chainRows, frameX, elevationSpecs, leanToSpecs, ltOpeningPlan, ltRect, ltWallH,
  elevLayout, paginate, trussFromFront,
} from '../layout-src/sheetGeom.js'
import { layoutOffset, fmtFtIn as crmFmt, sheetGeomFromRaw, leanToNotes, ltOpeningText } from '../src/lib/layoutFromQuote.js'

const here = dirname(fileURLToPath(import.meta.url))
function loadData() {
  const ctx = { window: {}, console }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(resolve(here, '../layout-src/data.js'), 'utf8'), ctx)
  return ctx.window
}

// The quote program's chain, lifted from quote-builder.html dimElevSVG
// (float stops, exact-dedupe, skip < 1/192 ft, `inside` by ±0.01) — the
// reference every sheet chain must equal.
function programChain(items, faceW) {
  const sorted = items.slice().sort((a, b) => a.x - b.x)
  let stops = [0]
  sorted.forEach((it) => { stops.push(it.x); stops.push(it.x + it.w) }); stops.push(faceW)
  stops = stops.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
  const out = []
  if (!sorted.length) return out
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1], d = b - a
    if (d < 1 / 192) continue
    const inside = sorted.some((it) => it.x <= a + 0.01 && it.x + it.w >= b - 0.01)
    out.push({ d: Math.round(d * 96), kind: inside ? 'width' : 'gap' })
  }
  return out
}
const q = (v) => Math.round(v * 96) / 96

// ── formatter ───────────────────────────────────────────────────────────────
test('fmtFtIn: feet-inches to the nearest 1/8″, fraction glyphs, never decimals', () => {
  assert.equal(fmtFtIn(8 + 11.75 / 12), '8′11¾″')
  assert.equal(fmtFtIn(3 + 0.25 / 12), '3′0¼″')
  assert.equal(fmtFtIn(6.67), '6′8″') // 80.04″ -> 80″
  assert.equal(fmtFtIn(6 + 8.04 / 12), '6′8″')
  assert.equal(fmtFtIn(6.666666666666667), '6′8″')
  assert.equal(fmtFtIn(4.16667), '4′2″')
  assert.equal(fmtFtIn(30), '30′')
  assert.equal(fmtFtIn(32 + 10.75 / 12), '32′10¾″')
  assert.equal(fmtFtIn(5 + 2.25 / 12), '5′2¼″')
  assert.equal(fmtFtIn(1 / 96), '0′0⅛″')
  assert.equal(fmtFtIn(0), '0′')
  assert.equal(fmtFtIn(NaN), '—')
})
test('one formatter: sheet == layout ftInTight == CRM notes, on every 1/8″ to 100′ (+ noise)', () => {
  const win = loadData()
  for (let n = 0; n <= 9600; n++) {
    for (const noise of [0, 0.004, -0.004]) {
      const ft = n / 96 + noise / 12
      const a = fmtFtIn(ft)
      assert.equal(a, win.ftInTight(ft), `ftInTight ${ft}`)
      assert.equal(a, crmFmt(ft), `crm ${ft}`)
      assert.ok(!/\d\.\d/.test(a), `no decimals: ${a}`)
    }
  }
})

// ── frames ──────────────────────────────────────────────────────────────────
test('frameX is the exact inverse of layoutFromQuote.layoutOffset on every wall', () => {
  const W = 30, L = 80
  for (const wall of ['front', 'back', 'left', 'right', 'divider']) {
    const span = wall === 'left' || wall === 'right' ? L : W
    for (let k = 0; k < 400; k++) {
      const w = q(1 + (k * 7.3) % 12), x = q(((k * 13.37) % (span - w)))
      const off = layoutOffset(wall === 'divider' ? 'front' : wall, x, w, W, L)
      assert.equal(e8(frameX({ wall, offset: off, w }, W, L)), e8(x), `${wall} x=${x}`)
    }
  }
})

// ── chain ───────────────────────────────────────────────────────────────────
test('chain equals the program chain (screenshot-106-like 80′ eave + random walls)', () => {
  // 80′ eave: walk 3′, window 3′0¼″, window 3′0¼″, walk 3′, frame-out 8′ wide (like the owner's screenshot)
  const items = [
    { x: q(4 + 4 / 12), w: 3 }, { x: q(16 + 3.75 / 12), w: q(3 + 0.25 / 12) }, { x: q(52 + 2.75 / 12), w: q(3 + 0.25 / 12) },
    { x: 64.25, w: 3 }, { x: q(70), w: 8 },
  ]
  const mine = chain(items, 80).map((s) => ({ d: s.d, kind: s.kind }))
  assert.deepEqual(mine, programChain(items, 80))
  assert.equal(mine.reduce((t, s) => t + s.d, 0), 80 * 96, 'adds up to the wall')
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let k = 0; k < 500; k++) {
    const F = 20 + Math.floor(rnd() * 80), n = 1 + Math.floor(rnd() * 5), its = []
    for (let i = 0; i < n; i++) { const w = q(2 + rnd() * 10); its.push({ x: q(rnd() * (F - w)), w }) }
    const a = chain(its, F).map((s) => ({ d: s.d, kind: s.kind }))
    assert.deepEqual(a, programChain(its, F), JSON.stringify(its))
    assert.equal(a.reduce((t, s) => t + s.d, 0), F * 96)
  }
  assert.deepEqual(chain([], 40), [])
})
test('chainRows: gaps on row 0, widths on row 1, bumped rows never overlap', () => {
  const items = [{ x: 1, w: 3 }, { x: 4.25, w: 3 }, { x: 7.5, w: 0.5 }, { x: 8.125, w: 0.5 }]
  const segs = chain(items, 30)
  const rows = chainRows(segs, (n) => 40 + (n / 96) * 20)
  rows.forEach((r) => assert.ok(r.kind === 'gap' ? [0, 2].includes(r.row) : [1, 3].includes(r.row)))
  for (const row of [0, 1, 2, 3]) {
    const on = rows.filter((r) => r.row === row).sort((a, b) => a.cx - b.cx)
    for (let i = 1; i < on.length; i++) {
      const pa = on[i - 1], pb = on[i]
      const ha = (pa.text.length * 5.4) / 2 + 2, hb = (pb.text.length * 5.4) / 2 + 2
      assert.ok(pb.cx - hb >= pa.cx + ha + 3 - 1e-9 || row < 2, `row ${row} overlap ${pa.text} / ${pb.text}`)
    }
  }
  assert.ok(rows.some((r) => r.row >= 2), 'tight labels drop to an extra row')
})

// ── the owner's case (10/6/26): CCI 30×50×12, left-eave 12′×50′ lean-to with storage ──
const B = { width: 30, length: 50, height: 12, pitch: '3:12', trussOC: 4, config: 'enclosed' }
const OPS = [
  { id: 'a', type: 'rollup', wall: 'front', offset: 10, w: 10, h: 10, sill: 0 },
  { id: 'b', type: 'window', wall: 'right', offset: q(50 - 32 - 10 / 12 - 2.5), w: 2.5, h: 2.5, sill: q(4 + 2 / 12) },
  { id: 'c', type: 'window', wall: 'right', offset: q(50 - 12 - 10 / 12 - 2.5), w: 2.5, h: 2.5, sill: q(4 + 2 / 12) },
  { id: 'd', type: 'walk', wall: 'left', offset: q(42 + 7 / 12), w: 3, h: q(6.67), sill: 0 },
]
const LT = {
  n: 1, side: 'Left Eave', k: 'left', w: 12, low: 9, pitch: 3, conn: 12, len: 50, ll: 50, start: 0,
  stor: { end: 'back', len: 24, at: 26 }, walls: { front: 'closed', back: 'closed', side: 'closed', mode: 'enclosed' },
  part: { len: 12, low: 9, slope: 0.25, pitch: 0.25, lowAtZero: false },
  openings: [
    { type: 'rollup', loc: 'outer', qty: 1, w: 8, h: 8, sill: 0, xs: [6], label: 'Roll-Up Door' },
    { type: 'wtd', loc: 'partition', qty: 1, w: 3, h: q(6.67), sill: 0, xs: [4.5], label: 'Walk-Through Door' },
    { type: 'win', loc: 'outer', qty: 1, w: 2.5, h: 2.5, sill: q(4.16667), xs: null, label: 'Window' },
  ],
}
const GEOM = { W: 30, L: 50, H: 12, truss: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48], oc: 4, leanTos: [LT], partition: null, open: {} }

test('owner case: one elevation per wall with openings, in the program order, lean-to included', () => {
  const tags = { a: 1, b: 2, c: 3, d: 4 }
  const specs = elevationSpecs(B, OPS, GEOM, tags)
  assert.deepEqual(specs.map((s) => s.key), ['front', 'right', 'left', 'lt1-outer', 'lt1-partition'])
  const front = specs[0]
  assert.deepEqual(front.ends, ['LEFT EAVE', 'RIGHT EAVE'])
  assert.equal(front.items[0].x, 10)
  assert.equal(front.side.length, 1, 'the left lean-to end-on beside the front gable')
  assert.equal(front.side[0].onLeft, true)
  const right = specs[1]
  assert.deepEqual(right.ends, ['FRONT GABLE', 'BACK GABLE'])
  // the schedule says 32′10″ / 12′10″ from the Front Gable: x from the front
  assert.deepEqual(right.items.map((i) => fmtFtIn(i.x)).sort(), ['12′10″', '32′10″'])
  assert.equal(right.items[0].sill, q(4 + 2 / 12))
  assert.deepEqual(right.truss, GEOM.truss)
  const left = specs[2]
  assert.deepEqual(left.ends, ['BACK GABLE', 'FRONT GABLE'])
  assert.equal(fmtFtIn(left.items[0].x), '42′7″')
  assert.equal(left.items[0].h, 80 / 12, 'walk door 6′8″ exactly')
  assert.deepEqual(left.truss, GEOM.truss.map((t) => 50 - t))
  assert.equal(left.foot.length, 1)
  assert.equal(left.foot[0].x0, 0) // runs the full length, seen from the left
  const outer = specs[3]
  assert.equal(outer.faceW, 50)
  assert.deepEqual(outer.ends, ['BACK END', 'FRONT END'])
  assert.equal(outer.items.length, 1)
  assert.equal(outer.items[0].x, 50 - 6 - 8, 'mirrored: x from the back end')
  assert.equal(outer.storX, 50 - 26)
  assert.equal(outer.notes.length, 1)
  assert.match(outer.notes[0], /Window 2′6″ × 2′6″ — position TBD/)
  const part = specs[4]
  assert.deepEqual(part.ends, ['MAIN WALL', 'OUTER POST'])
  assert.equal(part.items[0].x, 4.5)
  assert.equal(part.faceW, 12)
  assert.equal(part.h(12), 9) // low leg at the outer post
  assert.equal(part.h(0), 12) // main wall side
})

test('lean-to: walls without openings are skipped; partition TBD falls back to the outer wall notes', () => {
  const l = { ...LT, stor: null, openings: [{ type: 'win', loc: 'partition', qty: 1, w: 2.5, h: 2.5, xs: null, label: 'Window' }] }
  const specs = elevationSpecs(B, [], { ...GEOM, leanTos: [l] })
  assert.deepEqual(specs.map((s) => s.key), ['lt1-outer'])
  assert.match(specs[0].notes[0], /position TBD/)
})

test('size changed in the builder: the quote geometry is not drawn', () => {
  const specs = elevationSpecs({ ...B, length: 60 }, OPS, GEOM)
  assert.ok(specs.every((s) => !s.key.startsWith('lt')))
  assert.deepEqual(trussFromFront({ ...B, length: 60 }, null), [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56])
})

test('GCH: the divider wall is its own elevation (x from the left eave)', () => {
  const b = { ...B, width: 24, length: 40, config: 'hybrid', openEnd: 'front', openLength: 20 }
  const ops = [{ id: 'g', type: 'rollup', wall: 'divider', offset: 4, w: 10, h: 8, sill: 0 }]
  const specs = elevationSpecs(b, ops, null)
  assert.deepEqual(specs.map((s) => s.key), ['divider'])
  assert.equal(specs[0].items[0].x, 4)
  assert.deepEqual(specs[0].ends, ['LEFT EAVE', 'RIGHT EAVE'])
})

test('End Storage partition: drawn from the program items, seen from the front', () => {
  const g = { ...GEOM, leanTos: [], partition: { kind: 'y', end: 'back', depth: 12, at: 38, items: [{ type: 'rollup', x: 3.25, w: 8, h: 8, yo: 0 }] } }
  const specs = elevationSpecs(B, [], g)
  assert.deepEqual(specs.map((s) => s.key), ['partition'])
  assert.equal(specs[0].sub, '12′ from the back end · seen from the front')
  assert.deepEqual(chain(specs[0].items, 30).map((s) => s.d / 96), [3.25, 8, 18.75])
})

test('lean-to plan spots: outer / end / partition on each side', () => {
  const W = 30, L = 50
  const left = { k: 'left', w: 12, len: 50, start: 0, stor: { at: 26 } }
  assert.deepEqual(ltRect(left, W, L), { z0: 0, z1: 50, x0: -12, x1: 0 })
  assert.deepEqual(ltOpeningPlan(left, 'outer', 6, 8, W, L), { z0: 6, z1: 14, x0: -12, x1: -12 })
  assert.deepEqual(ltOpeningPlan(left, 'partition', 4.5, 3, W, L), { z0: 26, z1: 26, x0: -7.5, x1: -4.5 })
  const right = { k: 'right', w: 10, len: 20, start: 5, stor: null }
  assert.deepEqual(ltOpeningPlan(right, 'outer', 2, 3, W, L), { z0: 7, z1: 10, x0: 40, x1: 40 })
  assert.deepEqual(ltOpeningPlan(right, 'front', 1, 3, W, L), { z0: 5, z1: 5, x0: 36, x1: 39 })
  const front = { k: 'front', w: 10, len: 20, start: 4, stor: null }
  assert.deepEqual(ltRect(front, W, L), { z0: -10, z1: 0, x0: 4, x1: 24 })
  assert.deepEqual(ltOpeningPlan(front, 'outer', 2, 3, W, L), { z0: -10, z1: -10, x0: 19, x1: 22 })
  const back = { k: 'back', w: 10, len: 20, start: 4, stor: null }
  assert.deepEqual(ltRect(back, W, L), { z0: 50, z1: 60, x0: 6, x1: 26 })
  assert.deepEqual(ltOpeningPlan(back, 'back', 2, 3, W, L), { z0: 52, z1: 55, x0: 6, x1: 6 })
})

test('ltWallH: the sloped bent (low leg at the outer post, capped slope)', () => {
  const p = { len: 12, low: 9, slope: 0.25, lowAtZero: true }
  assert.equal(ltWallH(p, 0), 9)
  assert.equal(ltWallH(p, 12), 12)
  assert.equal(ltWallH({ ...p, lowAtZero: false }, 0), 12)
})

test('elevLayout: the wall, its side lean-tos and every label stay inside the drawing', () => {
  for (const spec of elevationSpecs(B, OPS, GEOM)) {
    const L = elevLayout(spec)
    assert.ok(L.X(-L.extL) >= 0 && L.X(spec.faceW + L.extR) <= L.VW - 60, spec.key)
    assert.ok(L.Y(spec.peak) >= 10, spec.key)
    assert.ok(L.VH > L.dy2 && L.VH < 330, `${spec.key} VH ${L.VH}`)
    L.rows.forEach((r) => assert.ok(r.cx > 0 && r.cx < L.VW))
  }
  // 80′ × 16′ wall like the owner's screenshot
  const sp = { key: 'x', faceW: 80, eave: 16, peak: 16, h: () => 16, items: [{ x: 4.333, w: 3, h: 6.667, sill: 0 }], side: [], ends: ['BACK GABLE', 'FRONT GABLE'] }
  const L2 = elevLayout(sp)
  assert.ok(L2.s > 7 && L2.s < 8.5, `scale ${L2.s}`)
})

test('paginate: 2–3 cards per page, approval on the last page', () => {
  assert.deepEqual(paginate([300, 300, 300, 300], 960, 150, 3, 0), { pages: [[0, 1, 2], [3, 'sign']], signOnP1: false })
  assert.deepEqual(paginate([300, 300, 300], 960, 150, 3, 0), { pages: [[0, 1], [2, 'sign']], signOnP1: false }, 'never an approval page on its own')
  assert.deepEqual(paginate([900], 960, 150, 3, 0), { pages: [[0], ['sign']], signOnP1: false })
  assert.deepEqual(paginate([400, 400, 400], 960, 150, 3, 0), { pages: [[0, 1], [2, 'sign']], signOnP1: false })
  assert.deepEqual(paginate([], 960, 150, 3, 200), { pages: [], signOnP1: true })
  assert.deepEqual(paginate([], 960, 150, 3, 100), { pages: [['sign']], signOnP1: false })
})

// ── CRM seed helpers ────────────────────────────────────────────────────────
test('sheetGeomFromRaw: only for the quote\'s own size; leanToNotes print the real sizes', () => {
  assert.equal(sheetGeomFromRaw({ geom: GEOM }, { width: 30, length: 60 }), null)
  assert.equal(sheetGeomFromRaw({}, { width: 30, length: 50 }), null)
  const g = sheetGeomFromRaw({ geom: GEOM }, { width: 30, length: 50, height: 12 })
  assert.equal(g.leanTos.length, 1)
  assert.deepEqual(g.truss, GEOM.truss)
  const [note] = leanToNotes([{ n: 1, side: 'Left Eave', w: 12, len: 50, low: 9, start: 0, stor: { end: 'back', len: 24 }, openings: '1× Walk-Through Door 6x6', openingList: LT.openings }])
  assert.match(note, /1× Roll-Up Door 8′×8′ \(outer wall\)/)
  assert.match(note, /1× Walk-Through Door 3′×6′8″ \(storage partition\)/)
  assert.match(note, /1× Window 2′6″×2′6″ \(outer wall, position TBD\)/)
  assert.ok(!/6x6/.test(note), 'never the stale size field')
  assert.equal(ltOpeningText({ qty: 2, label: 'Window', w: 2.5, h: 2.5, loc: 'front', xs: [1, 5] }, 'Front Gable'), '2× Window 2′6″×2′6″ (right-eave end wall)')
})
