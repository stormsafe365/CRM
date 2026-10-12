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
