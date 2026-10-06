// Unit tests for Open Layout ← quote (src/lib/layoutFromQuote.js) and the
// layout builder's seed helpers (layout-src/data.js). Run: npm test
//
// The elevation items below are real output of the quote program's
// collectElevItems() for a 30x40x12 quote built in the program (10/6/26):
//   front  roll-up 10x10 ×2: "3.5 From Left Eave" + "2 From Right Eave"
//   back   walk door "4 From Right Eave"; window "3 From Left Eave"
//   right  roll-up 10x8 "6 From Front Gable"; 2 windows on Auto (the
//          no-overlap model moved them: x = 22.333… / 31.1666…)
//   left   roll-up 9x8 "7.25 From Front Gable"; walk door "5 From Back Gable"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import {
  applyStar, buildingFromRaw, cleanLabel, elevToLayoutOpenings, finishKey, fmtFtIn, layoutOffset, leanToNotes,
  legTypeFor, pickLayoutQuote, q8, quoteOptionLabel, seedFromQuote, sortStarredFirst, starSupported,
} from '../src/lib/layoutFromQuote.js'

const here = dirname(fileURLToPath(import.meta.url))

const ELEV = {
  front: [{ type: 'rollup', x: 3.5, w: 10, h: 10 }, { type: 'rollup', x: 18, w: 10, h: 10 }],
  back: [{ type: 'wtd', x: 4, w: 3, h: 6.666666666666667 }, { type: 'win', x: 24.5, w: 2.5, h: 2.5, yo: 4.166666666666667 }],
  right: [{ type: 'rollup', x: 6, w: 10, h: 8 }, { type: 'win', x: 22.333333333333332, w: 2.5, h: 2.5, yo: 4.166666666666667 }, { type: 'win', x: 31.166666666666668, w: 2.5, h: 2.5, yo: 4.166666666666667 }],
  left: [{ type: 'rollup', x: 23.75, w: 9, h: 8 }, { type: 'wtd', x: 5, w: 3, h: 6.666666666666667 }],
  partition: [], W: 30, L: 40,
}

// The quote's own number for an opening: feet from the END its typed button
// names (posRefName) — derived back from the layout opening.
function farFromLayout(o, W, L) {
  const span = (o.wall === 'left' || o.wall === 'right') ? L : W
  return span - o.offset - o.w
}

test('front gable: offset = x from the LEFT eave corner (both buttons)', () => {
  const { openings } = elevToLayoutOpenings(ELEV)
  const f = openings.filter((o) => o.wall === 'front')
  assert.equal(f.length, 2)
  assert.equal(f[0].offset, 3.5) // typed 3.5 From Left Eave
  assert.equal(farFromLayout(f[1], 30, 40), 2) // typed 2 From Right Eave
  assert.equal(f[1].offset, 18)
  assert.deepEqual([f[0].type, f[0].w, f[0].h], ['rollup', 10, 10])
})

test('back gable: program x runs from the RIGHT eave corner; layout from the LEFT', () => {
  const { openings } = elevToLayoutOpenings(ELEV)
  const [door, win] = openings.filter((o) => o.wall === 'back')
  assert.equal(farFromLayout(door, 30, 40), 4) // typed 4 From Right Eave (left button on the back)
  assert.equal(door.offset, 23)
  assert.equal(win.offset, 3) // typed 3 From Left Eave (right button on the back)
  assert.equal(win.type, 'window')
  assert.equal(win.sill, q8(4.166666666666667))
  assert.equal(fmtFtIn(win.sill), '4′2″')
})

test('right eave: program x from the FRONT gable; layout from the BACK', () => {
  const { openings } = elevToLayoutOpenings(ELEV)
  const r = openings.filter((o) => o.wall === 'right')
  assert.equal(farFromLayout(r[0], 30, 40), 6) // typed 6 From Front Gable
  assert.equal(r[0].offset, 24)
  // Auto windows moved by the no-overlap model stay exact on the 1/8" grid
  assert.equal(r[1].offset * 96, Math.round((40 - 22.333333333333332 - 2.5) * 96))
  assert.equal(fmtFtIn(r[1].offset), '15′2″')
  assert.equal(fmtFtIn(r[2].offset), '6′4″')
})

test('left eave: program x from the BACK gable = layout offset', () => {
  const { openings } = elevToLayoutOpenings(ELEV)
  const [ru, wd] = openings.filter((o) => o.wall === 'left')
  assert.equal(farFromLayout(ru, 30, 40), 7.25) // typed 7.25 From Front Gable
  assert.equal(ru.offset, 23.75)
  assert.equal(wd.offset, 5) // typed 5 From Back Gable
  assert.equal(wd.type, 'walk')
})

test('every opening round-trips to the program x on the 1/8" grid', () => {
  const { openings } = elevToLayoutOpenings(ELEV)
  assert.equal(openings.length, 9)
  const back = { front: (o) => o.offset, left: (o) => o.offset, back: (o) => 30 - o.offset - o.w, right: (o) => 40 - o.offset - o.w }
  const byWall = { front: [], back: [], left: [], right: [] }
  openings.forEach((o) => byWall[o.wall].push(o))
  for (const k of Object.keys(byWall)) {
    byWall[k].forEach((o, i) => {
      assert.equal(Math.round(back[k](o) * 96), Math.round(ELEV[k][i].x * 96), `${k} #${i}`)
      assert.equal(Number.isInteger(Math.round(o.offset * 96)), true)
    })
  }
})

test('odd eighths survive (e.g. 3′2⅞″ from the back gable)', () => {
  const x = q8(3 + 2.875 / 12)
  assert.equal(fmtFtIn(layoutOffset('left', x, 3, 30, 40)), '3′2⅞″')
  assert.equal(fmtFtIn(layoutOffset('right', 40 - x - 3, 3, 30, 40)), '3′2⅞″')
  assert.equal(fmtFtIn(layoutOffset('back', 30 - x - 3, 3, 30, 40)), '3′2⅞″')
})

test('GCH: the program routes the partition to "front" -> layout divider', () => {
  const { openings } = elevToLayoutOpenings({ front: [{ type: 'rollup', x: 5, w: 10, h: 8 }], W: 24, L: 40 }, null, { gch: true })
  assert.equal(openings[0].wall, 'divider')
  assert.equal(openings[0].offset, 5)
})

test('End Storage partition openings become schedule notes (x from the left, seen from the front)', () => {
  const { openings, notes } = elevToLayoutOpenings({ partition: [{ type: 'rollup', x: 3.25, w: 8, h: 8 }], W: 30, L: 40 },
    { partition: [{ note: '' }] }, { partitionLabel: 'End Storage, back end' })
  assert.equal(openings.length, 0)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /Storage partition \(End Storage, back end\): Roll-Up Door 8′ × 8′ — 3′3″ from the left/)
})

test('labels: framed openings by component, notes from the program options', () => {
  const elev = { front: [{ type: 'fo', x: 2, w: 3, h: 6.67 }, { type: 'fo', x: 8, w: 2.5, h: 2.5, yo: 4 }, { type: 'fo', x: 14, w: 6, h: 7 }], W: 30, L: 40 }
  const labels = { front: [{ comp: 'Framed Opening — Walk-Through Door 36"x80"' }, { comp: 'Framed Opening — Window 30"x30"' }, { comp: 'Framed Opening — Custom Frame Out (Custom Size)' }] }
  const { openings } = elevToLayoutOpenings(elev, labels)
  assert.deepEqual(openings.map((o) => [o.type, o.name]), [['framed', 'Walk-Through Frame-Out'], ['framed', 'Window Frame-Out'], ['custom', 'Custom Frame-Out']])
  assert.equal(openings[1].sill, 4)
  // mismatched label counts are ignored rather than mis-assigned
  const r2 = elevToLayoutOpenings(elev, { front: [{ comp: 'x' }] })
  assert.equal(r2.openings[0].name, 'Frame-Out')
})

test('cleanLabel drops prices and manufacturer names', () => {
  assert.equal(cleanLabel('Hi-Wind Walk Door — $650'), 'Hi-Wind Walk Door')
  assert.equal(cleanLabel('9-Lite Door (+$75)'), '9-Lite Door')
  assert.equal(cleanLabel('CCI High-Impact Roll-Up Doors'), 'High-Impact Roll-Up Doors')
})

test('building: size, pitch, wind, truss spacing, gauge, legs, config', () => {
  const raw = { fields: { btype: 'standard', bw: '30', bl: '40', bh: '12', 'framing-upgrade': '12', wfg: 'Closed', wbg: 'Open', wre: 'Closed', wle: 'Closed', wain: 'no' }, mfr: 'CA', pitch: '4:12', wind: 170, trussOC: 4 }
  const { building, notes } = buildingFromRaw(raw)
  assert.deepEqual(building, { width: 30, length: 40, height: 12, pitch: '4:12', trussOC: 4, gauge: '12', legType: 'single', wind: 170, config: 'enclosed' })
  assert.deepEqual(notes, ['Back gable end: open'])
  // saved fields only (no program): spans + OC rule
  const b2 = buildingFromRaw({ fields: { btype: 'standard', bw: '24', bl: '30', bh: '10', 'oc-spacing': '5oc', _span_pitch: '3:12', '_span_cert-req': '150 MPH' } }).building
  assert.equal(b2.trussOC, 5); assert.equal(b2.wind, 150); assert.equal(b2.pitch, '3:12')
  const gch = buildingFromRaw({ fields: { btype: 'gch', bw: '24', bl: '40', bh: '12', 'gch-open': '20' } }).building
  assert.deepEqual([gch.config, gch.openEnd, gch.openLength, gch.gableSheet], ['hybrid', 'front', 20, 'gable'])
  assert.equal(buildingFromRaw({ fields: { btype: 'carport', bw: '20', bl: '20', bh: '8' } }).building.config, 'carport')
})

test('leg type follows the program badges (CCI ladder >31 wide, CA >=52; double at 16+)', () => {
  assert.equal(legTypeFor('CCI', 40, 12), 'ladder')
  assert.equal(legTypeFor('CA', 40, 12), 'single')
  assert.equal(legTypeFor('CA', 52, 12), 'ladder')
  assert.equal(legTypeFor('CA', 30, 16), 'double')
})

test('finishes: program color names -> layout catalog keys, wainscot', () => {
  const cat = { ca: { saharaTan: { name: 'Sahara Tan' }, galvalume: { name: 'Galvalume' }, black: { name: 'Black' } } }
  const raw = { fields: { bw: '30', bl: '40', bh: '12', wain: '3ft' }, mfr: 'CA', colors: { cr: { name: 'Galvalume', hex: '#b5b6b3' }, cw: { name: 'Sahara Tan', hex: '#b58a65' }, ct: { name: 'Pewter', hex: '#918d85' }, cwn: { name: 'Black', hex: '#0f0f0f' } } }
  const { finishes, mfr } = buildingFromRaw(raw, cat)
  assert.equal(mfr, 'ca')
  assert.deepEqual(finishes, { roof: 'galvalume', walls: 'saharaTan', trim: '#918D85', hasWainscot: true, wainscot: 'black' })
  assert.equal(finishKey(null, 'TBD', 'TBD'), 'TBD')
})

test('starred quote: picked first, else the newest; one star per lead', () => {
  const qs = [
    { id: 'a', quote_date: '2026-09-01', created_at: '2026-09-01T10:00:00Z', starred: false },
    { id: 'b', quote_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', starred: false },
    { id: 'c', quote_date: '2026-09-15', created_at: '2026-09-15T10:00:00Z', starred: true },
    { id: 'd', quote_date: '2026-10-05', created_at: '2026-10-05T10:00:00Z', starred: false, deleted_at: '2026-10-05T12:00:00Z' },
  ]
  assert.equal(pickLayoutQuote(qs).id, 'c')
  assert.deepEqual(sortStarredFirst(qs).map((q) => q.id), ['c', 'b', 'a'])
  assert.equal(pickLayoutQuote(qs.map((q) => ({ ...q, starred: false }))).id, 'b')
  const after = applyStar(qs, 'a', true)
  assert.deepEqual(after.filter((q) => q.starred).map((q) => q.id), ['a'])
  assert.deepEqual(applyStar(qs, 'c', false).filter((q) => q.starred), [])
  assert.equal(pickLayoutQuote([]), null)
})

test('star UI only when the starred column exists', () => {
  assert.equal(starSupported([{ id: 1, starred: false }]), true)
  assert.equal(starSupported([{ id: 1 }]), false)
  assert.equal(starSupported([]), false)
  // newest-first without the column
  assert.equal(pickLayoutQuote([{ id: 'x', quote_date: '2026-01-01' }, { id: 'y', quote_date: '2026-02-01' }]).id, 'y')
})

test('dropdown label', () => {
  assert.equal(quoteOptionLabel({ quote_number: 'SS-2026-01234', quote_date: '2026-10-06', total_amount: 12345, starred: true }),
    'Quote #SS-2026-01234 — 10/06/2026 — $12,345 ★')
  assert.equal(quoteOptionLabel({ quote_number: 'SS-1', quote_date: '2026-10-06' }), 'Quote #SS-1 — 10/06/2026')
})

test('seedFromQuote: openings + notes; no openings key + warning without the program', () => {
  const raw = { fields: { btype: 'standard', bw: '30', bl: '40', bh: '12', cn: 'Pat Doe', 'ct-siteaddr': '1 Main St' }, mfr: 'CCI', elev: ELEV, leanTos: [{ n: 1, side: 'Left Eave', w: 12, low: 8, len: 40, start: 0 }] }
  const s = seedFromQuote({ quote_number: 'SS-9' }, raw, { client: { name: 'Lead Name' } })
  assert.equal(s.openings.length, 9)
  assert.equal(s.customer, 'Pat Doe'); assert.equal(s.address, '1 Main St'); assert.equal(s.quoteNo, 'SS-9'); assert.equal(s.mfr, 'cci')
  assert.deepEqual(s.notes, [
    'Wind rating: not set on this quote (no engineered plans selected) — 150 MPH shown is the layout default; confirm before sending.',
    'Lean-to 1 — Left Eave, 12′ W × 40′ L, 8′ low eave, starts 0′ from the front gable',
  ])
  assert.equal(s.building.wind, 150) // the layout default (flagged), never the previous quote's value
  const s2 = seedFromQuote({ quote_number: 'SS-9' }, { fields: raw.fields }, {})
  assert.equal('openings' in s2, false)
  assert.match(s2.warning, /could not be read/)
  assert.deepEqual(leanToNotes([]), [])
})

// ── the layout builder side (layout-src/data.js, plain browser script) ─────
function loadLayoutData() {
  const ctx = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, Math, Date, JSON, Number, String, Array, Object, isFinite, isNaN, parseFloat }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(resolve(here, '../layout-src/data.js'), 'utf8'), ctx)
  return ctx.window
}

test('layout ftIn / ftInTight print eighths, whole inches unchanged', () => {
  const D = loadLayoutData()
  assert.equal(D.ftIn(12.5), '12′ 6″')
  assert.equal(D.ftInTight(6.666666666666667), '6′8″')
  assert.equal(D.ftInTight(10), '10′')
  assert.equal(D.ftInTight(3 + 2.875 / 12), '3′2⅞″')
  assert.equal(D.ftIn(15 + 2 / 12), '15′ 2″')
  assert.equal(D.ftIn(-1.5), '-1′ 6″')
})

test('layout seed helpers: backward compatible size seed + full quote seed', () => {
  const D = loadLayoutData()
  assert.deepEqual({ ...D.crmTweaks({ size: '30x40x12' }) }, { width: 30, length: 40, height: 12 })
  const t = D.crmTweaks({ building: { width: 24, length: 40, height: 12, wind: 170, pitch: '4:12', trussOC: 5, gauge: '12', legType: 'single', config: 'hybrid', openEnd: 'front', openLength: 20, gableSheet: 'gable' } })
  assert.deepEqual({ ...t }, { width: 24, length: 40, height: 12, wind: 170, openLength: 20, pitch: '4:12', trussOC: 5, gauge: '12', legType: 'single', config: 'hybrid', openEnd: 'front', gableSheet: 'gable' })
  const ops = D.crmOpenings(elevToLayoutOpenings(ELEV).openings)
  assert.equal(ops.length, 9)
  assert.equal(ops[0].offset, 3.5)
  assert.equal(new Set(ops.map((o) => o.id)).size, 9)
  assert.equal(D.crmOpenings([{ type: 'nope', wall: 'front', offset: 1 }]).length, 0)
  const prev = { customer: 'Old', address: 'Old addr', quoteNo: 'Q-OLD', mfr: 'ca', finishes: { roof: 'galvalume' } }
  const di = D.crmDocInfo(prev, { customer: 'New', quoteNo: 'SS-9', mfr: 'cci', finishes: { roof: 'white', hasWainscot: false }, notes: ['n1', ''] })
  assert.equal(di.customer, 'New'); assert.equal(di.address, 'Old addr'); assert.equal(di.quoteNo, 'SS-9'); assert.equal(di.mfr, 'cci')
  assert.equal(di.finishes.roof, 'white'); assert.deepEqual([...di.notes], ['n1'])
  // the old seed ({ size, customer, address }) leaves quote / finishes / notes alone
  const old = D.crmDocInfo(prev, { customer: 'X' })
  assert.equal(old.quoteNo, 'Q-OLD'); assert.equal(old.finishes.roof, 'galvalume'); assert.equal('notes' in old, false)
})
