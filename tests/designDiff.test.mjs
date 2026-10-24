// Unit tests for "what the customer changed" (src/lib/designDiff.js). Run: npm test
//
// Owner 10/20/26: the customer edits the building the rep sent and taps "Send to my steel building rep";
// the rep sees plain-English lines of what changed from the quote's building.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designDiff, diffSummary, fmtFt } from '../src/lib/designDiff.js'
import { quoteToSeed } from '../src/lib/designSeed.js'

const base = () => ({
  type: 'garage', width: 24, length: 40, height: 12, enclosedLength: 20, roofStyle: 'Vertical', pitch: 'standard', panels: 'Horizontal',
  walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  colors: { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' }, wainscot: false,
  openings: [
    { id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white' },
    { id: 'o2', kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 6, style: 'std' },
    { id: 'o3', kind: 'walk', wall: 'right', w: 3, h: 80 / 12, sill: 0, pos: 10, style: 'std' },
  ],
  leanTos: [], wraps: [],
  upgrades: { insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false },
})
const env = (d) => ({ schema: 'ss-web-design', v: 1, design: d, ctx: { zip: null, county: null, impact: false } })
const edit = (fn) => { const d = base(); fn(d); return env(d) }
const lines = (fn) => designDiff(env(base()), edit(fn)).map((c) => c.text)

test('nothing changed -> no lines (an envelope, a bare design, or a copy with the same numbers)', () => {
  assert.deepEqual(designDiff(env(base()), env(base())), [])
  assert.deepEqual(designDiff(base(), env(base())), [])
  // a position that differs by less than 1/8" is the same spot
  assert.deepEqual(lines((d) => { d.openings[0].pos = 7.005 }), [])
  assert.equal(diffSummary([], '1234'), 'No changes from quote #1234')
})

test('garbage in -> nothing, never a throw', () => {
  assert.deepEqual(designDiff(null, env(base())), [])
  assert.deepEqual(designDiff(env(base()), null), [])
  assert.deepEqual(designDiff({}, {}), [])
  assert.deepEqual(designDiff('x', 5), [])
})

test('size, walls, colors and style lines read like a person', () => {
  assert.deepEqual(lines((d) => { d.width = 30 }), ['Width 24′ → 30′'])
  assert.deepEqual(lines((d) => { d.length = 50; d.height = 14 }), ['Length 40′ → 50′', 'Height 12′ → 14′'])
  assert.deepEqual(lines((d) => { d.walls.back = 'open' }), ['Back end wall: Closed → Open'])
  assert.deepEqual(lines((d) => { d.walls.left = '2panel' }), ['Left side wall: Closed → 2 panels from the top (6′)'])
  assert.deepEqual(lines((d) => { d.colors.roof = 'barn-red' }), ['Roof color: Galvalume → Barn Red'])
  assert.deepEqual(lines((d) => { d.colors.walls = 'tan'; d.colors.trim = 'white' }), ['Wall color: Pewter Gray → Tan', 'Trim color: Black → White'])
  assert.deepEqual(lines((d) => { d.wainscot = true }), ['Wainscot: off → on'])
  assert.deepEqual(lines((d) => { d.roofStyle = 'Boxed Eave'; d.pitch = '4:12'; d.panels = 'Vertical' }), ['Roof style: Vertical → Boxed Eave', 'Roof pitch: standard → 4:12', 'Wall panels: Horizontal → Vertical'])
  assert.deepEqual(lines((d) => { d.type = 'carport' }), ['Type: Garage → Carport'])
  assert.deepEqual(lines((d) => { d.upgrades.oc4 = true; d.upgrades.insulation = 'roofWalls' }), ['Insulation: none → roof and walls', 'Upgrade added: Trusses 4′ on center'])
})

test('doors and windows: removed, added, moved, changed - matched by id, then by kind/wall/spot', () => {
  assert.deepEqual(lines((d) => { d.openings.splice(0, 1) }), ['Removed: 10×10 roll-up door, front end'])
  assert.deepEqual(lines((d) => { d.openings.push({ id: 'o4', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 20, style: 'std' }) }), ['Added: 3×7 walk door, left side'])
  assert.deepEqual(lines((d) => { d.openings[1].pos = 12 }), ['Moved: 30×30 window, left side: 6′ → 12′'])
  assert.deepEqual(lines((d) => { d.openings[0].w = 12 }), ['Changed: front end roll-up door size 10×10 → 12×10'])
  assert.deepEqual(lines((d) => { d.openings[0].color = 'barnRed' }), ['Roll-up door color (front end): White → Barn Red'])
  assert.deepEqual(lines((d) => { d.openings[2].style = '9lite' }), ['Changed: right side walk door: Standard, white → 9-lite (glass), white'])
  // a new id on the same part at the same spot is not a removal plus an addition
  assert.deepEqual(lines((d) => { d.openings[1].id = 'o9' }), [])
  // a dragged part that got a new id: moved, not removed + added
  assert.deepEqual(lines((d) => { d.openings[1].id = 'o9'; d.openings[1].pos = 15 }), ['Moved: 30×30 window, left side: 6′ → 15′'])
  // moved to another wall
  assert.deepEqual(lines((d) => { d.openings[1].wall = 'right' }), ['Moved: 30×30 window left side → right side'])
  // a fraction shows in inches
  assert.deepEqual(lines((d) => { d.openings[1].pos = 6.25 }), ['Moved: 30×30 window, left side: 6′ → 6′3″'])
})

test('impact-rated parts compare by the customer\'s own pick, so a ZIP change is not an edit', () => {
  const seed = base()
  const sent = base()
  sent.openings[2] = { ...sent.openings[2], style: 'hiwind', chosen: 'std' } // the page swapped in the rated door
  sent.openings[1] = { ...sent.openings[1], style: 'hi', chosen: 'std' }
  assert.deepEqual(designDiff(env(seed), env(sent)), [])
  sent.openings[2].chosen = '6panel' // the customer picked another door while the rated one shows
  assert.deepEqual(designDiff(env(seed), env(sent)).map((c) => c.text), ['Changed: right side walk door: Standard, white → 6-panel, white'])
})

test('lean-tos: added, removed, resized, walls, openings, wraps', () => {
  const lt = (side, over = {}) => ({ id: 'lt1', side, width: 12, length: 30, start: 0, lowLeg: 10, pitch: '2:12', enclosure: 'open', walls: { front: 'open', back: 'open', side: 'open' }, openings: [], ...over })
  const mk = (a, b) => designDiff(env({ ...base(), leanTos: a }), env({ ...base(), leanTos: b })).map((c) => c.text)
  assert.deepEqual(mk([], [lt('Right Eave')]), ['Lean-to added: right side 12′ × 30′'])
  assert.deepEqual(mk([lt('Right Eave')], []), ['Lean-to removed: right side 12′ × 30′'])
  assert.deepEqual(mk([lt('Front Gable')], [lt('Front Gable', { width: 16, length: 20, lowLeg: 8 })]), ['Front end lean-to width 12′ → 16′', 'Front end lean-to length 30′ → 20′', 'Front end lean-to low leg 10′ → 8′'])
  assert.deepEqual(mk([lt('Left Eave')], [lt('Left Eave', { enclosure: 'custom', walls: { front: 'closed', back: 'open', side: '2panel' } })]),
    ['Left side lean-to walls: Open → Custom walls', 'Left side lean-to front end: Open → Closed', 'Left side lean-to outer wall: Open → 2 panels from the top (6′)'])
  const door = { id: 'lo1', kind: 'rollup', wall: 'outer', w: 9, h: 8, sill: 0, pos: 10, color: 'white' }
  assert.deepEqual(mk([lt('Left Eave', { enclosure: 'enclosed' })], [lt('Left Eave', { enclosure: 'enclosed', openings: [door] })]), ['Added: 9×8 roll-up door, left side lean-to outer wall'])
  const wrapped = (w) => designDiff(env({ ...base(), leanTos: [lt('Left Eave'), lt('Front Gable', { id: 'lt2' })], wraps: [] }), env({ ...base(), leanTos: [lt('Left Eave'), lt('Front Gable', { id: 'lt2' })], wraps: w })).map((c) => c.text)
  assert.deepEqual(wrapped(['FL']), ['Wrap-around added: front-left corner'])
})

test('the summary line counts and names the quote', () => {
  assert.equal(diffSummary([{ kind: 'size', text: 'x' }], 'SS-2026-0042'), '1 change from quote #SS-2026-0042')
  assert.equal(diffSummary([1, 2, 3], 'A'), '3 changes from quote #A')
  assert.equal(diffSummary([], null), 'No changes from the building you sent')
  assert.equal(fmtFt(6), '6′')
  assert.equal(fmtFt(3.5), '3′6″')
  assert.equal(fmtFt(0.5), '0′6″')
})

test('end to end: a real seed, the customer adds a lean-to and moves the door', () => {
  const r = quoteToSeed({
    mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed' },
    doors: [{ rloc: 'Front Gable End', rsz: '10x10', rqt: '1', rco: 'white', positions: [{ val: '7', side: 'left' }] }],
  })
  assert.ok(r.ok)
  const sent = JSON.parse(JSON.stringify(r.seed))
  assert.deepEqual(designDiff(r.seed, sent), [])
  sent.design.openings[0].pos = 3
  sent.design.leanTos.push({ id: 'lt1', side: 'Right Eave', width: 12, length: 30, start: 0, lowLeg: 10, pitch: '2:12', enclosure: 'open', walls: { front: 'open', back: 'open', side: 'open' }, openings: [] })
  assert.deepEqual(designDiff(r.seed, sent).map((c) => c.text), ['Moved: 10×10 roll-up door, front end: 7′ → 3′', 'Lean-to added: right side 12′ × 30′'])
})

test('a design the WEBSITE sent (wrapped one level deeper) has no seed: no changes list, no error (owner 10/24/26)', () => {
  const sentByWebsite = { schema: 'ss-web-design', source: 'website', type: 'garage', width: 24, length: 40, height: 12, state: { schema: 'ss-web-design', v: 1, design: { ...base(), width: 30 }, ctx: { zip: null, county: null, impact: false } } }
  assert.deepEqual(designDiff(env(base()), sentByWebsite), []) // even against a seed, the website's builder is another model: nothing to compare
  assert.deepEqual(designDiff(null, sentByWebsite), [])
  assert.deepEqual(designDiff(undefined, { ...sentByWebsite, state: null }), [])
  // and the design link page's own rows are compared exactly as before
  assert.deepEqual(designDiff(env(base()), env({ ...base(), width: 30 })).map((c) => c.text), ['Width 24′ → 30′'])
})
