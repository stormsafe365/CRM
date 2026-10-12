// Wrap-around lean-tos (owner 10/12/26) on the CRM side: the Approval Sheet's
// plan corner squares + elevation "wrap length" bars (layout-src/sheetGeom.js),
// the seed geometry / notes (src/lib/layoutFromQuote.js) and the revision diff
// (a wrap change is ONE priced change, applied after the lean-tos it needs).
// Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elevationSpecs, elevLayout, wrapRect, ltWrapW } from '../layout-src/sheetGeom.js'
import { sheetGeomFromRaw, leanToNotes } from '../src/lib/layoutFromQuote.js'
import { diffBuilds, applyUnit } from '../src/lib/revisionDiff.js'

// Sensei config D: 24 x 40 x 12, Left 12x40 + Front 12x24 (10' low leg), wrapped Front Left.
const lt = (o) => ({ n: 1, side: 'Left Eave', k: 'left', w: 12, low: 10, pitch: 2, conn: 12, len: 40, ll: 40, start: 0, stor: null,
  walls: { front: 'open', back: 'open', side: 'open', mode: 'open' }, part: null, openings: [], ...o })
const LEFT = lt({ wrap: { len: 52, meets: [{ k: 'FL', w: 12 }] } })
const FRONT = lt({ n: 2, side: 'Front Gable', k: 'front', len: 24, ll: 24, wrap: { len: 36, meets: [{ k: 'FL', w: 12 }] } })
const geom = { W: 24, L: 40, H: 12, truss: [], oc: 5, leanTos: [LEFT, FRONT], partition: null, open: {}, clr: null, wraps: [{ k: 'FL', w: 12 }] }
const building = { width: 24, length: 40, height: 12, pitch: '3:12', config: 'enclosed', trussOC: 5 }

test('wrapRect: each corner square in plan coords (z from the front, x from the left eave) + its hip', () => {
  assert.deepEqual(wrapRect({ k: 'FL', w: 12 }, 24, 40), { z0: -12, z1: 0, x0: -12, x1: 0, mz: 0, mx: 0, oz: -12, ox: -12 })
  assert.deepEqual(wrapRect({ k: 'FR', w: 12 }, 24, 40), { z0: -12, z1: 0, x0: 24, x1: 36, mz: 0, mx: 24, oz: -12, ox: 36 })
  assert.deepEqual(wrapRect({ k: 'BL', w: 12 }, 24, 40), { z0: 40, z1: 52, x0: -12, x1: 0, mz: 40, mx: 0, oz: 52, ox: -12 })
  assert.deepEqual(wrapRect({ k: 'BR', w: 12 }, 24, 40), { z0: 40, z1: 52, x0: 24, x1: 36, mz: 40, mx: 24, oz: 52, ox: 36 })
  assert.equal(ltWrapW(LEFT, 'FL'), 12)
  assert.equal(ltWrapW(LEFT, 'BL'), 0)
})

test('elevations: the wrapped lean-to on its wall carries the corner past the right end (same frames as the program)', () => {
  const specs = elevationSpecs(building, [], geom, {}, { all: true })
  const front = specs.find((s) => s.key === 'front')
  // Front card: x from the left eave → the FL corner is past the LOW end
  assert.deepEqual(front.foot.map((f) => [f.x0, f.len, f.wA, f.wB, f.wrapLen, f.ll]), [[0, 24, 12, 0, 36, 24]])
  const left = specs.find((s) => s.key === 'left')
  // Left eave card: x from the BACK → the FL corner is past the HIGH end
  assert.deepEqual(left.foot.map((f) => [f.x0, f.len, f.wA, f.wB, f.wrapLen]), [[0, 40, 0, 12, 52]])
  const lay = elevLayout(front)
  assert.equal(lay.wrapFoot.length, 1)
  const plain = elevLayout({ ...front, foot: front.foot.map(({ wA, wB, ...f }) => f) })
  assert.equal(lay.VH - plain.VH, 34) // one wrap-length row
  // no wrap anywhere: feet carry no wrap keys (sheets drawn exactly as before)
  const g0 = { ...geom, wraps: undefined, leanTos: [lt({}), lt({ n: 2, side: 'Front Gable', k: 'front', len: 24, ll: 24 })] }
  const s0 = elevationSpecs(building, [], g0, {}, { all: true })
  assert.ok(s0.every((s) => (s.foot || []).every((f) => !('wA' in f))))
})

test('seed: geom keeps the wrapped corners; notes name the wrapped length', () => {
  const g = sheetGeomFromRaw({ geom }, building)
  assert.deepEqual(g.wraps, [{ k: 'FL', w: 12 }])
  assert.equal(sheetGeomFromRaw({ geom: { ...geom, wraps: undefined } }, building).wraps, undefined)
  const notes = leanToNotes([{ n: 1, side: 'Left Eave', w: 12, len: 40, low: 10, start: 0, wrap: { len: 52, corners: ['FL'] } }])
  assert.match(notes[0], /12′ W × 40′ L, wrapped length 52′ \(wraps the Front Left corner\)/)
})

test('revision diff: adding a wrap is one priced change, after the lean-to it needs', () => {
  const leantos = [{ lts: 'Left Eave', ltw: '12', ltl2: '40', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] }]
  const front = { lts: 'Front Gable', ltw: '12', ltl2: '24', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] }
  const base = { mfr: 'CCI', fields: { bw: '24', bl: '40', bh: '12' }, doors: [], wtds: [], windows: [], addcomps: [], leantos }
  const next = { ...base, leantos: [...leantos, front], ltWraps: 'FL' }
  const { blockers, units } = diffBuilds(base, next)
  assert.deepEqual(blockers, [])
  assert.deepEqual(units.map((u) => u.kind + ':' + (u.field || u.cat)), ['add:leantos', 'field:ltWraps'])
  assert.equal(units[1].desc, 'Wrap-around lean-to corners: none → Front Left')
  let work = { ...base }
  for (const u of units) work = applyUnit(work, u)
  assert.equal(work.ltWraps, 'FL')
  assert.equal(work.leantos.length, 2)
  // removing it again
  const back = diffBuilds(next, { ...next, ltWraps: undefined })
  assert.deepEqual(back.units.map((u) => u.desc), ['Wrap-around lean-to corners: Front Left → none'])
  assert.equal('ltWraps' in applyUnit(next, back.units[0]), false)
  // no wraps on either side: no wrap unit (old quotes diff exactly as before)
  assert.deepEqual(diffBuilds(base, { ...base }).units, [])
})

// ── Verify fixes (10/12/26) ───────────────────────────────────────────────
import { priceChanges, r2 } from '../src/lib/revisionDiff.js'
import { applyWrapMarks, wrapMarksOf } from '../src/lib/revisionWrapMarks.js'
import { wrapBarLabel } from '../layout-src/sheetGeom.js'

// A toy price engine with the program's wrap shape: each lean-to 100·w + 10·l; a corner holds when it is
// requested and both of its lean-tos are there with the same width; each held corner adds $300 and the
// corner square to BOTH lean-tos (10·w each) — so a wrap can't hold between two width steps.
const SIDES = { FL: ['Left Eave', 'Front Gable'], FR: ['Right Eave', 'Front Gable'], BL: ['Left Eave', 'Back Gable'], BR: ['Right Eave', 'Back Gable'] }
function toyPrice(p) {
  const lts = p.leantos || []
  let sum = lts.reduce((s, l) => s + 100 * Number(l.ltw) + 10 * Number(l.ltl2) + 50 * (l.accs || []).length, 0)
  for (const k of String(p.ltWraps || '').split(',').filter(Boolean)) {
    const a = lts.find((l) => l.lts === SIDES[k][0]), b = lts.find((l) => l.lts === SIDES[k][1])
    if (a && b && a.ltw === b.ltw) sum += 300 + 2 * 10 * Number(a.ltw)
  }
  return sum
}
const LT = (lts, w, l, extra = {}) => ({ lts, ltw: String(w), ltl2: String(l), lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [], ...extra })
const B0 = (leantos, ltWraps) => ({ mfr: 'CCI', fields: { bw: '24', bl: '40', bh: '12' }, doors: [], wtds: [], windows: [], addcomps: [], leantos, ...(ltWraps ? { ltWraps } : {}) })
async function itemize(base, next) {
  const { units } = diffBuilds(base, next)
  const res = await priceChanges({ base, units, priceOf: async (p) => toyPrice(p), nextSub: toyPrice(next) })
  return { units, lines: res.lines.map((l) => [l.desc.replace(/ —.*$/, ''), l.amount]), residual: res.residual }
}

test('revision order (verify 10/12/26): removing a lean-to with its wrap — the wrap comes off FIRST and carries its own price', async () => {
  const base = B0([LT('Left Eave', 12, 40), LT('Front Gable', 12, 24)], 'FL')
  const next = B0([LT('Left Eave', 12, 40)])
  const r = await itemize(base, next)
  assert.deepEqual(r.units.map((u) => u.kind + ':' + (u.field || u.cat)), ['field:ltWraps', 'remove:leantos'])
  assert.deepEqual(r.lines, [['Wrap-around lean-to corners: Front Left → none', -540], ['Remove lean-to attached', -1440]])
  assert.equal(r.residual, 0)
})

test('revision order: both wrapped lean-tos narrowed 12 → 10, wrap kept — each lean-to line is its own change, the wrap difference is ONE line', async () => {
  const base = B0([LT('Left Eave', 12, 40), LT('Front Gable', 12, 24)], 'FL')
  const next = B0([LT('Left Eave', 10, 40), LT('Front Gable', 10, 24)], 'FL')
  const r = await itemize(base, next)
  assert.deepEqual(r.units.map((u) => u.kind + ':' + (u.field || u.cat)), ['field:ltWraps', 'change:leantos', 'change:leantos', 'field:ltWraps'])
  assert.deepEqual(r.lines.map(([d, a]) => [d.replace(/^Lean-to.*$/, 'Lean-to change'), a]), [
    ['Lean-to change', -200], ['Lean-to change', -200], ['Wrap-around lean-to corners: Front Left (re-priced for the lean-to change)', -40]])
  assert.equal(r.lines.reduce((s, [, a]) => s + a, 0), toyPrice(next) - toyPrice(base))
  assert.equal(r.residual, 0)
})

test('revision order: a kept wrap whose re-price is $0 prints no line; an accessory-only change never touches the wrap', async () => {
  // Left lengthened 40 → 45 with FL kept: the corner's price is the same → no wrap line
  const base = B0([LT('Left Eave', 12, 40), LT('Front Gable', 12, 24)], 'FL')
  const r = await itemize(base, B0([LT('Left Eave', 12, 45), LT('Front Gable', 12, 24)], 'FL'))
  assert.deepEqual(r.lines.map(([d]) => d), ['Lean-to attached'])
  // a door added to the wrapped Left lean-to: one lean-to line, no wrap steps at all
  const acc = await itemize(base, B0([LT('Left Eave', 12, 40, { accs: [{ 'lt-acc-type': 'wtd', 'lt-acc-qty': '1' }] }), LT('Front Gable', 12, 24)], 'FL'))
  assert.deepEqual(acc.units.map((u) => u.kind + ':' + (u.field || u.cat)), ['change:leantos'])
  // adding a wrap still goes on after the lean-to it needs (unchanged)
  const add = await itemize(B0([LT('Left Eave', 12, 40)]), base)
  assert.deepEqual(add.lines, [['Add lean-to attached', 1440], ['Wrap-around lean-to corners: none → Front Left', 540]])
})

// A fake program window for the revision marks (holdBuilderAt → applyWrapMarks).
function fakePg(lts, active, lens) {
  const els = lts.map((f, i) => {
    const F = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { value: String(v) }]))
    return { dataset: {}, querySelector: (s) => F[s] || null, _len: lens[i] }
  })
  return { els, pg: { document: { querySelectorAll: () => els }, ltWraps: () => ({ active: active.split(',').filter(Boolean) }), ltWrapOf: (el) => ({ len: el._len }) } }
}
const F = (lts, w, l, off = 0) => ({ '.lts': lts, '.ltw': w, '.ltl2': l, '.ltoff': off, '.lt-type': 'attached' })

test('revised contract marks (verify 10/12/26): an unchanged wrap tags nothing; a removed wrap tags its lean-tos', () => {
  // signed config D (FL), reopened in the engine
  const signed = fakePg([F('Left Eave', 12, 40), F('Front Gable', 12, 24)], 'FL', [52, 36])
  const marks = wrapMarksOf(signed.pg)
  assert.deepEqual(marks, { active: 'FL', lts: [{ sig: 'Left Eave|12|40|0|attached', len: 52 }, { sig: 'Front Gable|12|24|0|attached', len: 36 }] })
  // revision adds a walk door elsewhere: the live build still wraps FL -> marks = today = no tags
  const live = fakePg([F('Left Eave', 12, 40), F('Front Gable', 12, 24)], 'FL', [52, 36])
  applyWrapMarks(live.pg, marks)
  assert.deepEqual(live.els.map((e) => e.dataset.rvWrap), ['52', '36'])
  assert.equal(live.pg._rvWraps, 'FL')
  // revision removes the wrap: the lean-tos now price unwrapped -> their marks keep the signed lengths (CHANGED)
  const unwrapped = fakePg([F('Left Eave', 12, 40), F('Front Gable', 12, 24)], '', [0, 0])
  applyWrapMarks(unwrapped.pg, marks)
  assert.deepEqual(unwrapped.els.map((e) => e.dataset.rvWrap), ['52', '36'])
  // a lean-to the revision added / changed is marked as such; a list that shifted still pairs up by its sig
  const shifted = fakePg([F('Right Eave', 12, 40), F('Left Eave', 12, 40), F('Front Gable', 12, 24)], 'FL', [0, 52, 36])
  applyWrapMarks(shifted.pg, marks, (i) => i === 0)
  assert.deepEqual(shifted.els.map((e) => e.dataset.rvWrap), ['(as signed)', '52', '36'])
  // no marks (older engine): today's state, so nothing is tagged by the wrap
  const none = fakePg([F('Left Eave', 12, 40)], 'FL', [52])
  applyWrapMarks(none.pg, null)
  assert.deepEqual([none.els[0].dataset.rvWrap, none.pg._rvWraps], ['52', 'FL'])
})

test('Approval Sheet (verify W2): a wrap bar shorter than its label puts the label under the bar, in a taller row', () => {
  const g = { ...geom, leanTos: [lt({ side: 'Right Eave', k: 'right', len: 20, ll: 20, start: 20, wrap: { len: 32, meets: [{ k: 'BR', w: 12 }] } }),
    lt({ n: 2, side: 'Back Gable', k: 'back', len: 12, ll: 12, start: 0, wrap: { len: 24, meets: [{ k: 'BR', w: 12 }] } })], wraps: [{ k: 'BR', w: 12 }] }
  const back = elevationSpecs(building, [], g, {}, { all: true }).find((s) => s.key === 'back')
  const lay = elevLayout(back)
  assert.deepEqual(lay.wrapBelow, [true])
  const plain = elevLayout({ ...back, foot: back.foot.map(({ wA, wB, ...f }) => f) })
  assert.equal(lay.VH - plain.VH, 34 + 18)
  assert.equal(wrapBarLabel(back.foot[0]), 'LT2 wrap length 24′ (12′ + 12′ corner)')
  // config D's 36' front bar still fits: label boxed on the bar, row unchanged
  const front = elevationSpecs(building, [], geom, {}, { all: true }).find((s) => s.key === 'front')
  assert.deepEqual(elevLayout(front).wrapBelow, [false])
})
