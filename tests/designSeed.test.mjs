// Unit tests for the design-link seed mapper (src/lib/designSeed.js). Run: npm test
//
// Owner 10/20/26: send a lead a link that opens ON THEIR OWN BUILDING (from their saved quote, no prices); they edit
// it and tap "Send to my steel building rep"; the rep sees what changed. The seed is handed to the anonymous design
// page by its token, so it must carry the building and nothing else.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designDiff } from '../src/lib/designDiff.js'
import { quoteToSeed, settleDesign, impactFor, parseCounty, parseZip, mapSide, SEED_MAX_CHARS, cleanContact, contactWords } from '../src/lib/designSeed.js'

const seedOf = (payload, opts) => {
  const r = quoteToSeed(payload, opts)
  assert.ok(r.ok, r.reason)
  return r
}
const settled = (seed) => JSON.stringify(settleDesign(seed.design, seed.ctx.impact)) === JSON.stringify(seed.design)

// ── real fixtures from the specs ────────────────────────────────────────────────────────────────────────────

// tests/layoutFromQuote.test.mjs: CA standard 30x40x12, 12 GA, back gable open
const LAYOUT_FIXTURE = { mfr: 'CA', fields: { btype: 'standard', bw: '30', bl: '40', bh: '12', 'framing-upgrade': '12', wfg: 'Closed', wbg: 'Open', wre: 'Closed', wle: 'Closed', wain: 'no' } }
// tests/leanToWrap.test.mjs: CCI 24x40x12, a left-eave and a front-gable lean-to, wrapped front-left
const WRAP_FIXTURE = {
  mfr: 'CCI',
  fields: { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed', zip: '33401', county: 'Palm Beach' },
  leantos: [
    { lts: 'Left Eave', ltw: '12', ltl2: '40', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] },
    { lts: 'Front Gable', ltw: '12', ltl2: '24', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] },
  ],
  ltWraps: 'FL',
}

test('fixture: layoutFromQuote quote -> garage, 12 GA, back open, page default colors', () => {
  const r = seedOf(LAYOUT_FIXTURE)
  assert.equal(r.seed.schema, 'ss-web-design')
  assert.equal(r.seed.v, 1)
  const d = r.seed.design
  assert.deepEqual([d.type, d.width, d.length, d.height, d.enclosedLength, d.roofStyle, d.pitch, d.panels], ['garage', 30, 40, 12, 20, 'Vertical', 'standard', 'Horizontal'])
  assert.deepEqual(d.walls, { front: 'closed', back: 'open', left: 'closed', right: 'closed' })
  assert.equal(d.upgrades.frame12, true)
  assert.deepEqual(d.openings, [])
  assert.deepEqual(d.colors, { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' })
  assert.ok(r.notes.some((n) => /Roof color was not chosen/.test(n)))
  assert.equal(r.seed.ctx.impact, false) // an alternate-maker quote never has the impact lock
  assert.ok(settled(r.seed))
})

test('fixture: wrap-around lean-tos (left eave + front gable, FL) and the Palm Beach impact rule', () => {
  const r = seedOf(WRAP_FIXTURE)
  const d = r.seed.design
  assert.deepEqual(d.leanTos.map((l) => [l.id, l.side, l.width, l.length, l.start, l.lowLeg, l.pitch, l.enclosure]), [
    ['lt1', 'Left Eave', 12, 40, 0, 10, '2:12', 'open'],
    ['lt2', 'Front Gable', 12, 24, 0, 10, '2:12', 'open'],
  ])
  assert.deepEqual(d.leanTos[0].walls, { front: 'open', back: 'open', side: 'open' })
  assert.deepEqual(d.wraps, ['FL'])
  assert.deepEqual(r.seed.ctx, { zip: '33401', county: 'Palm Beach', impact: true })
  assert.ok(settled(r.seed))
  // a rep override removes the lock; an alternate-maker quote never has it
  assert.equal(seedOf({ ...WRAP_FIXTURE, overrides: { imp: true } }).seed.ctx.impact, false)
  assert.equal(seedOf({ ...WRAP_FIXTURE, mfr: 'CA' }).seed.ctx.impact, false)
  assert.deepEqual(seedOf({ ...WRAP_FIXTURE, mfr: 'CA' }).seed.design.wraps, []) // wraps are a CCI-only feature
})

test('fixture: garage + carport (GCH) 24x40x12, enclosed 20, with wainscot and upgrades', () => {
  const r = seedOf({
    mfr: 'CCI',
    fields: { btype: 'gch', bw: '24', bl: '40', bh: '12', ws: 'Vertical', wfg: 'Open', wbg: 'Closed', wre: 'Open', wle: 'Open', 'gch-enc': '20', 'gch-left': 'open', 'gch-right': 'open', wain: 'yes', cwn: '#B0A183', 'insul-sel': 'roof', 'oc-spacing': '4oc', 'sheeting-upgrade': 'upgrade' },
    doors: [{ rloc: 'Partition Wall', rsz: '10x8', rqt: '1', rco: 'white', rop: '1', positions: [{ val: '4', side: 'left' }] }],
  })
  const d = r.seed.design
  assert.deepEqual([d.type, d.width, d.length, d.height, d.enclosedLength, d.panels], ['combo', 24, 40, 12, 20, 'Vertical'])
  assert.deepEqual(d.walls, { front: 'open', back: 'closed', left: 'open', right: 'open' })
  assert.equal(d.wainscot, true)
  assert.equal(d.colors.wainscot, 'print-richwood') // vertical panels keep the printed wainscot
  assert.deepEqual(d.upgrades, { insulation: 'roof', frame12: false, oc4: true, angle45: false, panels26: true, colorScrews: false, openers: true })
  // the roll-up door on the garage/carport divider
  assert.deepEqual(d.openings.map((o) => [o.id, o.kind, o.wall, o.w, o.h, o.pos, o.color]), [['o1', 'rollup', 'partition', 10, 8, 4, 'white']])
  assert.ok(settled(r.seed))
})

test('fixture: carport with half-panel sides (Frick) - remapped to a page value, with a note', () => {
  const r = seedOf({ mfr: 'CCI', fields: { btype: 'carport', bw: '16', bl: '40', bh: '16', wfg: 'Open', wbg: 'Open', wle: 'Open', wre: 'Open', 'sp-left': 'closed', 'sp-right': '2_5panel' } })
  const d = r.seed.design
  assert.equal(d.type, 'carport')
  assert.deepEqual(d.walls, { front: 'open', back: 'open', left: 'closed', right: 'q2' }) // 7′6″ on a 16′ wall = ½ closed (8′)
  assert.ok(r.notes.some((n) => /Right side wall: 2½ panels \(7′6″\) is not a page choice, shown as ½ closed/.test(n)), r.notes.join('|'))
  assert.ok(settled(r.seed))
})

test('half-panel rule: nearest band, tie to the larger, closed when it reaches the wall; no half panel survives', () => {
  const n = new Set()
  const at = (v, H) => mapSide(v, H, 'left side', n)
  assert.deepEqual([8, 9, 10, 12, 14, 16, 20].map((H) => at('1_5panel', H)), ['q2', 'q2', 'q2', '2panel', 'q1', 'q1', 'q1'])
  assert.deepEqual([8, 9, 10, 12, 14, 16, 20].map((H) => at('2_5panel', H)), ['2panel', 'q3', 'q3', '3panel', 'q2', 'q2', '3panel'])
  assert.deepEqual([8, 9, 10, 12, 14, 16, 20].map((H) => at('3_5panel', H)), ['closed', 'closed', 'closed', '3panel', 'q3', 'q3', 'q2'])
  assert.equal(at('3panel', 9), 'closed') // 9′ of band on a 9′ wall: the page hides that choice
  assert.equal(at('Open', 10), 'open')
  assert.equal(at('Closed', 10), 'closed')
  assert.equal(at('q1', 10), 'q1')
})

test('fixture: wide span with the other maker\'s colors (nearest page color, with notes) and wide-span locks', () => {
  const r = seedOf({
    mfr: 'CA',
    fields: { btype: 'widespan', bw: '40', bl: '60', bh: '14', ws: 'Vertical', rs: 'Boxed Eve', wfg: 'Open', wbg: 'Closed', wle: 'Closed', wre: 'Closed', cr: '#B8BDC2', cw: '#6B6360', ct: '#1A1A1A', wain: 'yes', cwn: '#C47F2A' },
  })
  const d = r.seed.design
  assert.equal(d.type, 'garage') // wide span is the garage family
  assert.equal(d.roofStyle, 'Vertical') // wide span / long buildings are vertical only
  assert.deepEqual(d.colors, { roof: 'galvalume', walls: 'quaker-gray', trim: 'black', wainscot: 'tan' })
  assert.ok(r.notes.some((n) => /Wall color Charcoal matched to the nearest page color, Quaker Gray/.test(n)))
  assert.ok(r.notes.some((n) => /Wainscot color Copper Penny has no match on the page: shown as Tan/.test(n)))
  assert.ok(r.notes.some((n) => /Roof style Boxed Eave is vertical only/.test(n)))
  assert.ok(!r.notes.some((n) => /Roof color Galvalume/.test(n))) // an exact match needs no note
  assert.ok(settled(r.seed))
})

test('the page-side clean-up is applied: sizes snap, 6:12 stays (on the page since 10/30/26), GCH ends, tall sizes', () => {
  const r = seedOf({ mfr: 'CCI', fields: { btype: 'standard', bw: '31', bl: '40', bh: '19', 'pitch-sel': '6:12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed', cr: '#B9BCBB', cw: '#8A8A88', ct: '#1D1E20' } })
  const d = r.seed.design
  assert.deepEqual([d.width, d.height, d.pitch], [30, 18, '6:12'])
  assert.ok(r.notes.some((n) => /Width 31′ is not a page size: shown as 30′/.test(n)))
  assert.ok(r.notes.some((n) => /Height 19′ is not a page height: shown as 18′/.test(n)))
  assert.ok(!r.notes.some((n) => /Roof pitch/.test(n)))
  const g = seedOf({ mfr: 'CCI', fields: { btype: 'gch', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Open', 'gch-enc': '2', 'gch-left': 'open', 'gch-right': 'open' } })
  assert.equal(g.seed.design.walls.front, 'open')
  assert.equal(g.seed.design.walls.back, 'closed')
  assert.equal(g.seed.design.enclosedLength, 5)
  assert.ok(g.notes.some((n) => /front end of a garage \+ carport is always open/.test(n)))
  assert.ok(g.notes.some((n) => /back end of a garage \+ carport is always closed/.test(n)))
})

// ── refusals ────────────────────────────────────────────────────────────────────────────────────────────────

test('refuses what the page cannot hold', () => {
  const base = { mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '40', bh: '12' } }
  const refused = (mut) => { const r = quoteToSeed({ ...base, fields: { ...base.fields, ...mut } }); assert.equal(r.ok, false); assert.ok(r.reason && r.reason.length > 10); return r.reason }
  assert.match(refused({ btype: 'fslean' }), /free-standing lean-to/i)
  assert.match(refused({ btype: '' }), /no building type/i)
  assert.match(refused({ btype: 'bogus' }), /no building type/i)
  assert.match(refused({ bw: '61' }), /60′ wide/)
  assert.match(refused({ bl: '201' }), /200′ long/)
  assert.match(refused({ bh: '22' }), /20′ tall/)
  assert.match(refused({ bw: 'abc' }), /missing/i)
  assert.match(refused({ bl: '' }), /missing/i)
  assert.equal(quoteToSeed({}).ok, false)
  assert.equal(quoteToSeed(null).ok, false)
  assert.match(quoteToSeed({ mfr: 'CCI' }).reason, /entered by hand/)
  assert.equal(quoteToSeed({ fields: 'x' }).ok, false)
  assert.equal(quoteToSeed(base).ok, true)
})

// ── doors and windows ───────────────────────────────────────────────────────────────────────────────────────

const OPEN_BASE = { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed' }
const quote = (extra) => ({ mfr: 'CCI', fields: { ...OPEN_BASE }, doors: [], wtds: [], windows: [], addcomps: [], leantos: [], ...extra })

test('typed positions: the first-button number, or the far-end formula for the second button (W=24, L=40)', () => {
  const r = seedOf(quote({
    doors: [
      { rloc: 'Front Gable End', rsz: '10x8', rqt: '1', positions: [{ val: '4', side: 'left' }] },
      { rloc: 'Back Gable End', rsz: '10x8', rqt: '1', positions: [{ val: '4', side: 'right' }] },
    ],
    wtds: [
      { wloc: 'Left Eave Side', whi: 'std', wqt: '1', positions: [{ val: '6', side: 'left' }] },
      { wloc: 'Left Eave Side', whi: '6panel', wqt: '1', positions: [{ val: '6', side: 'right' }] },
      { wloc: 'Right Eave Side', whi: 'std', wqt: '1', positions: [{ val: '6', side: 'right' }] },
    ],
  }))
  const by = (w) => r.seed.design.openings.filter((o) => o.wall === w).map((o) => o.pos)
  assert.deepEqual(by('front'), [4])
  assert.deepEqual(by('back'), [10]) // 24 - 4 - 10
  assert.deepEqual(by('left'), [6, 31]) // 1st button 6; 2nd button 40 - 6 - 3
  assert.deepEqual(by('right'), [31])
  assert.equal(r.seed.design.openings.find((o) => o.style === '6panel').wall, 'left')
  assert.ok(settled(r.seed))
  assert.ok(!r.notes.some((n) => /Auto-spaced/.test(n))) // everything was typed
})

test('Auto positions are recomputed from the program spacing and flagged; the program\'s own spots win when read', () => {
  const q = quote({
    doors: [{ rloc: 'Front Gable End', rsz: '10x8', rqt: '2', positions: [{ val: '', side: 'left' }, { val: '', side: 'left' }] }],
    wtds: [{ wloc: 'Left Eave Side', whi: 'std', wqt: '3', positions: [{ val: '' }, { val: '' }, { val: '' }] }],
  })
  const typed = seedOf(q)
  assert.deepEqual(typed.seed.design.openings.filter((o) => o.wall === 'front').map((o) => o.pos), [1.3333333333333333, 12.666666666666666])
  // left eave: program x = 7.75 / 18.5 / 29.25 from the back = page 29.25 / 18.5 / 7.75
  assert.deepEqual(typed.seed.design.openings.filter((o) => o.wall === 'left').map((o) => o.pos), [29.25, 18.5, 7.75])
  assert.ok(typed.notes.some((n) => /Auto-spaced doors and windows were placed/.test(n)))
  assert.equal(typed.positions, 'typed')
  // the program's spots (collectElevItems, the no-overlap model moved them): front x from the left, left x from the BACK gable
  const layout = {
    W: 24, L: 40,
    elev: {
      front: [{ type: 'rollup', x: 3.6667, w: 10, h: 8, yo: 0 }, { type: 'rollup', x: 13, w: 10, h: 8, yo: 0 }],
      left: [{ type: 'wtd', x: 31, w: 3, h: 6.67, yo: 0 }, { type: 'wtd', x: 20, w: 3, h: 6.67, yo: 0 }, { type: 'wtd', x: 4, w: 3, h: 6.67, yo: 0 }],
      back: [], right: [], partition: [],
    },
  }
  const prog = seedOf(q, { layout })
  assert.equal(prog.positions, 'program')
  assert.deepEqual(prog.seed.design.openings.filter((o) => o.wall === 'front').map((o) => o.pos), [3.6667, 13].map((x) => Math.round(x * 96) / 96))
  assert.deepEqual(prog.seed.design.openings.filter((o) => o.wall === 'left').map((o) => o.pos), [6, 17, 33]) // 40 - x - 3
  assert.ok(!prog.notes.some((n) => /Auto-spaced/.test(n)))
  // a stale layout (other size) is not trusted
  assert.equal(seedOf(q, { layout: { ...layout, W: 30 } }).positions, 'typed')
  // a layout whose items do not line up with the quote falls back for that opening only
  const odd = seedOf(q, { layout: { ...layout, elev: { ...layout.elev, front: [{ type: 'wtd', x: 1, w: 3 }] } } })
  assert.equal(odd.positions, 'typed')
})

test('a GCH divider and front items share the program\'s front list (split by the saved location)', () => {
  const layout = { W: 24, L: 40, elev: { front: [{ type: 'rollup', x: 5, w: 10, h: 8 }, { type: 'wtd', x: 12, w: 3, h: 6.67 }], back: [], left: [], right: [], partition: [] } }
  const r = seedOf({
    mfr: 'CCI', fields: { btype: 'gch', bw: '24', bl: '40', bh: '12', 'gch-enc': '20', wfg: 'Open', wbg: 'Closed', 'gch-left': 'open', 'gch-right': 'open' },
    doors: [{ rloc: 'Front Gable End', rsz: '10x8', rqt: '1', positions: [{ val: '' }] }], // the open carport end: not on the page
    wtds: [{ wloc: 'Partition Wall', whi: 'std', wqt: '1', positions: [{ val: '' }] }],
  }, { layout })
  assert.deepEqual(r.seed.design.openings.map((o) => [o.kind, o.wall, o.pos]), [['walk', 'partition', 12]])
  assert.ok(r.notes.some((n) => /front of a garage \+ carport are not on the page/.test(n)))
})

test('roll-up sizes/colors, walk and window styles, impact counties, framed openings', () => {
  const r = seedOf(quote({
    fields: { ...OPEN_BASE, county: 'Lee', zip: '33901' },
    doors: [
      { rloc: 'Front Gable End', rsz: '12x10', rqt: '1', rco: 'barnRed', positions: [{ val: '2' }] },
      { rloc: 'Back Gable End', rsz: '7x7', rqt: '1', rco: 'nope', positions: [{ val: '2' }] }, // 7 wide is not on the page: nearest 6 (8 ties down? 7 is 1 from 6 and 8 -> the first)
    ],
    wtds: [{ wloc: 'Left Eave Side', whi: 'hiwind', wqt: '1', positions: [{ val: '6' }] }, { wloc: 'Left Eave Side', whi: '9lite', wqt: '1', positions: [{ val: '12' }] }],
    windows: [{ nloc: 'Right Eave Side', ntp: 'hi3036', nqt: '1', positions: [{ val: '5' }] }, { nloc: 'Right Eave Side', ntp: 'b3030', nqt: '1', positions: [{ val: '14' }] }],
    addcomps: [
      { act: 'Framed Opening — Custom Frame Out (Custom Size)', acq: '1', 'fo-cw': '60', 'fo-ch': '84', 'fo-unit': 'in', 'fo-loc': 'Right Eave Side', positions: [{ val: '24' }] },
      { act: 'Framed Opening — 45° Angle (+ Frameout Charge)', acq: '1', 'fo-loc': 'Back Gable End', positions: [{ val: '' }] },
      { act: 'J-Trim', acq: '1' },
    ],
  }))
  const d = r.seed.design
  assert.equal(r.seed.ctx.impact, true)
  const front = d.openings.find((o) => o.wall === 'front')
  assert.deepEqual([front.w, front.h, front.color], [12, 10, 'barnRed'])
  const back = d.openings.find((o) => o.wall === 'back')
  assert.equal(back.color, 'white')
  assert.ok(back.w === 6 || back.w === 8)
  const walks = d.openings.filter((o) => o.kind === 'walk')
  assert.deepEqual(walks.map((o) => [o.style, o.chosen]), [['hiwind', 'hiwind'], ['hiwind', '9lite']]) // impact area: shown rated, the pick is remembered
  const wins = d.openings.filter((o) => o.kind === 'window')
  assert.deepEqual(wins.map((o) => [o.style, o.chosen, o.h]), [['hi3036', 'hi3036', 3], ['hi', 'b3030', 2.5]])
  const frame = d.openings.find((o) => o.kind === 'frame')
  assert.deepEqual([frame.frame, frame.w, frame.h, frame.sill], ['door', 5, 7, 0])
  assert.equal(d.openings.length, 7) // the 45° cut (a charge) and the J-Trim are not openings
  assert.ok(r.notes.some((n) => /45° angle cuts and double-tubed ends are charges/.test(n)))
  assert.deepEqual(d.openings.map((o) => o.id), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'])
  assert.ok(settled(r.seed))
})

test('a rep\'s non-impact quote in an impact county keeps its parts (impact off), and an unknown part is kept plain', () => {
  const r = seedOf(quote({
    fields: { ...OPEN_BASE, county: 'Palm Beach' }, overrides: { imp: true },
    wtds: [{ wloc: 'Left Eave Side', whi: 'std', wqt: '1', positions: [{ val: '6' }] }],
    windows: [{ nloc: 'Right Eave Side', ntp: 'std', nqt: '1', positions: [{ val: '5' }] }],
  }))
  assert.equal(r.seed.ctx.impact, false)
  assert.deepEqual(r.seed.design.openings.map((o) => [o.style, o.chosen]), [['std', undefined], ['std', undefined]])
  assert.ok(r.notes.some((n) => /does not use impact-rated parts here/.test(n)))
})

test('CA parts: walk "hi" is the impact walk door, door colors are white with a note', () => {
  const r = seedOf({
    mfr: 'CA', fields: { ...OPEN_BASE },
    doors: [{ rloc: 'Front Gable End', rsz: '10x10', rqt: '1', rco: 'bronze', positions: [{ val: '3' }] }],
    wtds: [{ wloc: 'Left Eave Side', whi: 'hi', wqt: '1', positions: [{ val: '6' }] }],
    windows: [{ nloc: 'Right Eave Side', ntp: 'hi', nqt: '1', positions: [{ val: '5' }] }],
  })
  const d = r.seed.design
  assert.equal(d.openings.find((o) => o.kind === 'rollup').color, 'white')
  assert.equal(d.openings.find((o) => o.kind === 'walk').style, 'hiwind')
  assert.equal(d.openings.find((o) => o.kind === 'window').style, 'hi')
  assert.ok(r.notes.some((n) => /colors other than white are not on the page/.test(n)))
  assert.equal(r.seed.ctx.impact, false)
  assert.ok(settled(r.seed))
})

test('window size: an off-grid size keeps its centre; a stored sill that differs is noted', () => {
  const r = seedOf(quote({ windows: [{ nloc: 'Front Gable End', ntp: 'std', nqt: '1', nsill: '6', positions: [{ val: '5' }] }] }))
  assert.equal(r.seed.design.openings[0].sill, 50 / 12)
  assert.ok(r.notes.some((n) => /Window height off the floor is fixed at 4′2″/.test(n)))
})

// ── lean-tos ────────────────────────────────────────────────────────────────────────────────────────────────

test('lean-tos: one per side, free-standing rows dropped, 4/5 panels, storage, open lean-to accessories', () => {
  const r = seedOf(quote({
    leantos: [
      { lts: 'Left Eave', ltw: '12', ltl2: '40', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'custom', 'lt-wall-front': 'closed', 'lt-wall-back': 'gable', 'lt-wall-side': '4panel', accs: [] },
      { lts: 'Left Eave', ltw: '10', ltl2: '20', lth: '8', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] }, // a second one on the same side
      { lts: 'Right Eave', ltw: '12', ltl2: '30', lth: '10', ltp: '3:12', 'lt-type': 'freestanding', 'lt-wm': 'open', accs: [] },
      { lts: 'Back Gable', ltw: '10', ltl2: '24', lth: '8', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', 'lt-stor': 'back', accs: [{ 'lt-acc-type': 'wtd', 'lt-acc-loc': 'outer', 'lt-acc-qty': '1' }] },
    ],
  }))
  const lts = r.seed.design.leanTos
  assert.deepEqual(lts.map((l) => [l.id, l.side]), [['lt1', 'Left Eave'], ['lt2', 'Back Gable']])
  assert.deepEqual(lts[0].walls, { front: 'closed', back: 'gable', side: 'closed' })
  assert.equal(lts[0].enclosure, 'custom')
  assert.deepEqual(lts[1].openings, []) // an open lean-to has no walls to put a door in
  const has = (re) => assert.ok(r.notes.some((n) => re.test(n)), re + ' in ' + r.notes.join(' | '))
  has(/free-standing lean-to \(right side\) is not on the page/)
  has(/one lean-to per side: a second lean-to on the left side/)
  has(/4 panels from the top, which the page does not have: shown as closed/)
  has(/storage section is not on the page/)
  has(/saved on a lean-to that is open/)
  assert.ok(settled(r.seed))
})

test('lean-to openings: the program\'s closed-form spots, qty expansion, capped at 12, unique ids', () => {
  const lt = {
    lts: 'Left Eave', ltw: '12', ltl2: '40', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'enclosed',
    accs: [
      { 'lt-acc-type': 'rollup', 'lt-acc-size': '9x8', 'lt-acc-color': 'white', 'lt-acc-qty': '1', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'auto' },
      { 'lt-acc-type': 'wtd', 'lt-acc-wtd-hi': 'std', 'lt-acc-qty': '2', 'lt-acc-loc': 'front', 'lt-acc-pos': 'auto' },
      { 'lt-acc-type': 'wtd', 'lt-acc-wtd-hi': 'std', 'lt-acc-qty': '1', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'center' },
      { 'lt-acc-type': 'win', 'lt-acc-win-hi': 'w3036', 'lt-acc-qty': '2', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'offset', offs: ['4', '20'] },
      { 'lt-acc-type': 'frameout', 'lt-acc-fo-type': 'Framed Opening — Window 30"x30"', 'lt-acc-fo-w': '2.5', 'lt-acc-fo-h': '2.5', 'lt-acc-fo-sill': '3', 'lt-acc-qty': '1', 'lt-acc-loc': 'back', 'lt-acc-pos': 'center' },
      { 'lt-acc-type': 'rollup', 'lt-acc-qty': '1', 'lt-acc-loc': 'partition' },
    ],
  }
  const r = seedOf(quote({ leantos: [lt] }))
  const ops = r.seed.design.leanTos[0].openings
  const get = (kind, wall) => ops.filter((o) => o.kind === kind && o.wall === wall)
  assert.deepEqual(get('rollup', 'outer').map((o) => [o.w, o.h, o.pos]), [[9, 8, 15.5]])
  assert.deepEqual(get('walk', 'front').map((o) => o.pos), [2, 7])
  assert.deepEqual(get('walk', 'outer').map((o) => o.pos), [18.5])
  assert.deepEqual(get('window', 'outer').map((o) => [o.style, o.pos, o.h]), [['w3036', 4, 3], ['w3036', 20, 3]])
  const fr = get('frame', 'back')[0]
  assert.deepEqual([fr.frame, fr.sill], ['window', 50 / 12])
  assert.ok(ops.every((o) => /^lo\d+$/.test(o.id)) && new Set(ops.map((o) => o.id)).size === ops.length)
  assert.ok(r.notes.some((n) => /storage partition are not on the page/.test(n)))
  assert.ok(settled(r.seed))
  // 20 openings on one lean-to: 12 are carried, with a note
  const many = { ...lt, accs: [{ 'lt-acc-type': 'wtd', 'lt-acc-wtd-hi': 'std', 'lt-acc-qty': '20', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'offset', offs: ['1'] }] }
  const m = seedOf(quote({ leantos: [many] }))
  assert.equal(m.seed.design.leanTos[0].openings.length, 12)
  assert.ok(m.notes.some((n) => /12 doors and windows per lean-to/.test(n)))
  // the program's own spots (ltAccXs) beat the closed form
  const prog = seedOf(quote({ leantos: [lt] }), {
    layout: { W: 24, L: 40, elev: { front: [], back: [], left: [], right: [], partition: [] }, geom: { leanTos: [{ n: 1, openings: [
      { type: 'rollup', loc: 'outer', qty: 1, xs: [3.5] }, { type: 'wtd', loc: 'front', qty: 2, xs: [1.5, 7.5] }, { type: 'wtd', loc: 'outer', qty: 1, xs: [20] },
      { type: 'win', loc: 'outer', qty: 2, xs: [4, 20] }, { type: 'fo', loc: 'back', qty: 1, xs: [4.75] },
    ] }] } },
  })
  const po = prog.seed.design.leanTos[0].openings
  assert.deepEqual(po.filter((o) => o.kind === 'rollup').map((o) => o.pos), [3.5])
  assert.deepEqual(po.filter((o) => o.kind === 'walk' && o.wall === 'front').map((o) => o.pos), [1.5, 7.5])
  assert.deepEqual(po.filter((o) => o.kind === 'frame').map((o) => o.pos), [4.75])
})

test('lean-to sizes the page cannot hold are snapped and noted (width, low leg, length)', () => {
  const r = seedOf(quote({ leantos: [{ lts: 'Right Eave', ltw: '13', ltl2: '300', lth: '13', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'open', accs: [] }] }))
  const l = r.seed.design.leanTos[0]
  assert.deepEqual([l.width, l.length, l.lowLeg], [12, 40, 10]) // 12 + 12*2/12 = 14 > 12′ eave: 10
  assert.ok(r.notes.some((n) => /right side lean-to width 13′ shown as 12′/.test(n)))
  assert.ok(r.notes.some((n) => /length 300′ shown as 40′/.test(n)))
  assert.ok(r.notes.some((n) => /low leg 13′ shown as 10′/.test(n)))
})

// ── what must never be in a seed ────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = ['cn', 'cp', 'ce', 'ct-billaddr', 'ct-siteaddr', 'notes', 'rep', 'disc', 'add-disc', 'tax', 'adj-amt', 'priced', 'totals', 'price_history', 'overrides', 'mfr', 'manufacturer',
  'total_amount', 'deposit_amount', 'quote_number', 'rendering_thumb', 'sessionEdits', 'card', 'client_id', 'name', 'phone', 'email', 'address']
const keysOf = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) } return out }

// a small deterministic generator (so a failure reproduces)
const LEAD = { id: 'c9', name: '  Lee <b>Lead"`  ', phone: ' (561) 555-0177 ', email: ' lee@example.com ', address_line: '9 Secret Rd', status: 'working', notes: 'private' }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('a seed never carries names, phones, addresses, prices, tax or a maker name - 300 varied quotes', () => {
  const R = rng(20261020)
  const pick = (a) => a[Math.floor(R() * a.length)]
  const SIDES = ['Closed', 'Open', '1panel', '1_5panel', '2panel', '2_5panel', '3panel', 'q1', 'q2']
  let made = 0, withOpenings = 0, withLeanTos = 0
  for (let i = 0; i < 300; i++) {
    const mfr = pick(['CCI', 'CA'])
    const q = {
      mfr, manufacturer: mfr === 'CA' ? 'ca' : 'cci',
      fields: {
        btype: pick(['standard', 'widespan', 'carport', 'gch']), bw: pick(['16', '24', '30', '40']), bl: pick(['24', '40', '60']), bh: pick(['8', '10', '12', '14']),
        wfg: pick(['Open', 'Closed']), wbg: 'Closed', wle: pick(SIDES), wre: pick(SIDES), 'gch-enc': '20', 'gch-left': 'open', 'gch-right': 'open',
        cr: pick(['#B9BCBB', '#6B6360', 'TBD']), cw: pick(['#8A8A88', '#7D3030']), ct: '#1D1E20',
        cn: 'Pat Q. Customer', cp: '(561) 555-0147', ce: 'pat@example.com', 'ct-siteaddr': '12 Palm Way', 'ct-billaddr': '1 Main St', notes: 'gate code 4455', rep: 'Jenna', disc: '500', tax: '7%', 'add-disc': '100', 'adj-amt': '250', zip: '33401', county: pick(['Palm Beach', 'Polk', '']),
      },
      priced: { total: 23200, free: { fastener: false } }, totals: { total: 23200, deposit: 6000 }, quote_number: 'SS-2026-0099', card: { roofColor: 'Galvalume' }, rendering_thumb: 'data:image/png;base64,AAA',
      overrides: { fu14: false, imp: false },
      doors: [{ rloc: pick(['Front Gable End', 'Back Gable End']), rsz: '10x8', rqt: '1', rco: 'white', positions: [{ val: '4' }] }],
      wtds: [{ wloc: 'Left Eave Side', whi: pick(['std', 'hi']), wqt: '1', positions: [{ val: '' }] }],
      windows: [{ nloc: 'Right Eave Side', ntp: 'std', nqt: pick(['1', '2']), positions: [{ val: '6' }, { val: '' }] }],
      leantos: R() < 0.5 ? [{ lts: pick(['Left Eave', 'Back Gable']), ltw: '10', ltl2: '20', lth: '8', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'enclosed', accs: [{ 'lt-acc-type': 'wtd', 'lt-acc-qty': '1', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'auto' }] }] : [],
    }
    const r = quoteToSeed(q, { quote: { id: 'q1', quote_number: 'SS-2026-0099', total_amount: 23200 }, contact: LEAD })
    if (!r.ok) continue
    made++
    if (r.seed.design.openings.length) withOpenings++
    if (r.seed.design.leanTos.length) withLeanTos++
    // the one allowed personal block: exactly the lead's name / phone / email, nothing of the quote's own customer fields
    assert.deepEqual(r.seed.contact, { name: 'Lee bLead', phone: '(561) 555-0177', email: 'lee@example.com' })
    const { contact, ...body } = r.seed
    assert.ok(contact)
    assert.ok(JSON.stringify(r.seed).length <= SEED_MAX_CHARS)
    const json = JSON.stringify(body)
    const found = FORBIDDEN_KEYS.filter((k) => keysOf(body).has(k))
    assert.deepEqual(found, [], `forbidden keys in a seed: ${found}`)
    assert.doesNotMatch(json, /Pat Q|555-0147|pat@example|Palm Way|Main St|gate code|Jenna|SS-2026|\$\s?\d|\d,\d{3}\b|data:image/)
    assert.doesNotMatch(json, /carolina|carports anywhere|\bCCI\b|\bCA\b|eversafe|manufacturer/i)
    assert.deepEqual(Object.keys(r.seed).sort(), ['contact', 'ctx', 'design', 'schema', 'v'])
    assert.doesNotMatch(JSON.stringify(r.seed), /Pat Q|555-0147|pat@example|Palm Way|Main St|gate code|Secret Rd|private|working/i)
    assert.deepEqual(Object.keys(r.seed.ctx).sort(), ['county', 'impact', 'zip'])
    assert.ok(settled(r.seed), 'a seed survives the page clean-up unchanged')
    // the notes are for the rep and stay clear of prices and quote numbers too
    assert.doesNotMatch(r.notes.join(' '), /\$\s?\d|SS-2026|Pat Q/)
  }
  assert.ok(made > 150 && withOpenings > 100 && withLeanTos > 40, `${made}/${withOpenings}/${withLeanTos}`)
})

test('helpers: county and ZIP parsing, impact rule', () => {
  assert.equal(parseCounty('Palm Beach County'), 'Palm Beach')
  assert.equal(parseCounty('St Lucie'), 'St. Lucie')
  assert.equal(parseCounty('miami dade'), 'Miami-Dade')
  assert.equal(parseCounty('—'), null)
  assert.equal(parseCounty(''), null)
  assert.equal(parseZip('33401-1234'), '33401')
  assert.equal(parseZip('abc'), null)
  assert.equal(impactFor({ mfr: 'CCI', county: 'Manatee', width: 20, length: 20 }), true)
  assert.equal(impactFor({ mfr: 'CCI', county: 'Volusia', width: 20, length: 20 }), false) // windows only there: the quote's own parts show
  assert.equal(impactFor({ mfr: 'CCI', county: 'Okaloosa', width: 30, length: 30 }), true)
  assert.equal(impactFor({ mfr: 'CCI', county: 'Okaloosa', width: 20, length: 30 }), false)
  assert.equal(impactFor({ mfr: 'CCI', county: 'Lee', width: 20, length: 30, overrides: { grand: { imp: true } } }), false)
  assert.equal(impactFor({ mfr: 'CA', county: 'Lee', width: 20, length: 30 }), false)
})

test('contact: the lead name, phone and email only, cleaned and capped; junk is left out', () => {
  const q = { mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '40', bh: '12' } }
  assert.deepEqual(quoteToSeed(q, { contact: LEAD }).seed.contact, { name: 'Lee bLead', phone: '(561) 555-0177', email: 'lee@example.com' })
  assert.equal(quoteToSeed(q).seed.contact, undefined)
  assert.equal(quoteToSeed(q, { contact: { name: '', phone: '12', email: 'nope' } }).seed.contact, undefined)
  assert.equal(quoteToSeed(q, { contact: { name: 'A'.repeat(300), phone: '5615550177', email: 'a@b.co' } }).seed.contact.name.length, 120)
  assert.deepEqual(Object.keys(cleanContact(LEAD)).sort(), ['email', 'name', 'phone'])
})

test('45 degree cut: set when any roll-up door has it; the diff reports it', () => {
  const base = { mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed' }, doors: [{ rloc: 'Front Gable End', rsz: '10x8', rqt: '1', r45: 'no', positions: [{ val: '4' }] }, { rloc: 'Front Gable End', rsz: '8x8', rqt: '1', r45: 'yes', positions: [{ val: '16' }] }] }
  const r = quoteToSeed(base)
  assert.equal(r.seed.design.upgrades.angle45, true)
  assert.equal(quoteToSeed({ ...base, doors: [base.doors[0]] }).seed.design.upgrades.angle45, false)
  assert.ok(settled(r.seed))
  const sent = JSON.parse(JSON.stringify(r.seed)); sent.design.upgrades.angle45 = false
  assert.deepEqual(designDiff(r.seed, sent).map((c) => c.text), ['Upgrade removed: 45° angle cut on roll-up doors'])
})

test('contact phone: kept only as a plain 10-11 digit number; extensions, letters and short numbers are left out; the review words match', () => {
  const ph = (p) => cleanContact({ name: 'A', phone: p }).phone
  assert.equal(ph('(561) 771-5555'), '(561) 771-5555')
  assert.equal(ph('+1 561 771 5555'), '+1 561 771 5555')
  assert.equal(ph('(561) 771-5555 ext 12'), undefined)
  assert.equal(ph('561-771-5555 x12'), undefined)
  assert.equal(ph('771-5555'), undefined)
  assert.equal(ph('56177155551234'), undefined)
  assert.equal(contactWords({ name: 'A', phone: '5617715555', email: 'a@b.co' }), 'name, phone and email')
  assert.equal(contactWords({ name: 'A', email: 'a@b.co' }), 'name and email')
  assert.equal(contactWords({ phone: '5617715555' }), 'phone')
})
