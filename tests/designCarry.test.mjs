// Owner 10/30/26: the design page has 6:12 and a chain hoist / brush seal on each roll-up door; a design that comes back
// from a link started on a quote KEEPS what the customer could not change there (designCarry.js). Run: npm test
//
// "We CANNOT be quoting people wrong": every rule below is checked both ways (kept when it should be, left alone when the
// customer changed it), and no price ever goes into what is handed to the program.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quoteToSeed, settleDesign } from '../src/lib/designSeed.js'
import { designToQuote, cciHoistIncluded } from '../src/lib/designToQuote.js'
import { carryFromQuote, notesLeft } from '../src/lib/designCarry.js'
import { designDiff } from '../src/lib/designDiff.js'

const env = (design, ctx = { zip: '33411', county: 'Palm Beach', impact: false }) => ({ schema: 'ss-web-design', v: 1, design, ctx })
const ok = (r) => { assert.ok(r.ok, r.reason); return r }
const text = (r) => r.checks.map((c) => c.text).join('\n')
const BASE = {
  type: 'garage', width: 24, length: 30, height: 14, enclosedLength: 20, roofStyle: 'Vertical', pitch: 'standard', panels: 'Horizontal',
  walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  colors: { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' },
  wainscot: false, openings: [], leanTos: [], wraps: [],
  upgrades: { insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false, angle45: false },
}
const design = (patch) => settleDesign({ ...JSON.parse(JSON.stringify(BASE)), ...patch }, false)

// ── the page's options -> the program ─────────────────────────────────────────────────────────────────────────────
test('chain hoist included: the same sizes as the quote program (CCI chart, cciCertHoistIncluded)', () => {
  const qb = readFileSync(new URL('../public/build/quote-builder.html', import.meta.url), 'utf8')
  const src = qb.match(/function cciCertHoistIncluded\(size\)\{[\s\S]*?\n\}/)
  assert.ok(src, 'program rule found')
  const prog = new Function(`${src[0]}; return cciCertHoistIncluded;`)()
  for (const w of [6, 8, 9, 10, 12, 14, 16]) for (const h of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) assert.equal(cciHoistIncluded(w, h), prog(`${w}x${h}`), `${w}x${h}`)
})

test('hoist / seal ticks become the entry counts; a size with a hoist saves 0; doors with different ticks are separate entries', () => {
  const d = design({
    openings: [
      { id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 2, color: 'white', hoist: true, seal: true },
      { id: 'o2', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 13, color: 'white', hoist: true, seal: true },
      { id: 'o3', kind: 'rollup', wall: 'back', w: 10, h: 10, sill: 0, pos: 2, color: 'white', seal: true },
      { id: 'o4', kind: 'rollup', wall: 'back', w: 10, h: 10, sill: 0, pos: 13, color: 'white' },
      { id: 'o5', kind: 'rollup', wall: 'left', w: 14, h: 12, sill: 0, pos: 5, color: 'white', hoist: true },
    ],
  })
  const r = ok(designToQuote(env(d), { zip: '33411' }))
  assert.deepEqual(r.payload.doors.map((e) => [e.rloc, e.rsz, e.rqt, e.rch, e.rsl]), [
    ['Front Gable End', '10x10', '2', '2', '2'],
    ['Back Gable End', '10x10', '1', '0', '1'],
    ['Back Gable End', '10x10', '1', '0', '0'],
    ['Left Eave Side', '14x12', '1', '0', '0'], // 14' wide comes with a hoist: Included, nothing to add
  ])
  assert.ok(!/chain hoists, brush seals/.test(text(r)))
})

test('lean-to roll-ups: hoist / seal counts on the lean-to door', () => {
  const d = design({
    leanTos: [{ id: 'lt1', side: 'Left Eave', width: 12, length: 30, start: 0, lowLeg: 10, pitch: '2:12', enclosure: 'enclosed', walls: { front: 'closed', back: 'closed', side: 'closed' },
      openings: [{ id: 'lo1', kind: 'rollup', wall: 'outer', w: 8, h: 7, sill: 0, pos: 5, color: 'white', hoist: true, seal: true }] }],
  })
  const a = ok(designToQuote(env(d), { zip: '33411' })).payload.leantos[0].accs[0]
  assert.deepEqual([a['lt-acc-ch'], a['lt-acc-sl']], ['1', '1'])
})

test('6:12 goes to the program as 6:12', () => {
  assert.equal(ok(designToQuote(env(design({ pitch: '6:12' })), { zip: '33411' })).payload.fields['pitch-sel'], '6:12')
})

test('a quote -> the page: 6:12 stays; hoists / seals land on the first that many doors of each entry', () => {
  const q = {
    mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '30', bh: '14', 'pitch-sel': '6:12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed', cr: '#B9BCBB', cw: '#8A8A88', ct: '#1D1E20', zip: '33411', county: 'Palm Beach' },
    doors: [{ rloc: 'Front Gable End', rdtype: 'rollup', rsz: '10x10', rqt: '2', rch: '1', rsl: '2', rop: '0', r45: 'no', rco: 'white', positions: [{ val: '2', side: 'left' }, { val: '13', side: 'left' }] }],
  }
  const r = quoteToSeed(q)
  assert.ok(r.ok, r.reason)
  const ds = r.seed.design
  assert.equal(ds.pitch, '6:12')
  assert.deepEqual(ds.openings.map((o) => [o.hoist === true, o.seal === true]), [[true, true], [false, true]])
  assert.ok(!r.notes.some((n) => /Door options|Roof pitch/.test(n)))
  // and back: the same counts (two entries now: the doors differ), same total price parts
  const back = ok(designToQuote(env(ds), { zip: '33411' })).payload
  assert.equal(back.fields['pitch-sel'], '6:12')
  const sum = (k) => back.doors.reduce((s, e) => s + Number(e[k]), 0)
  assert.deepEqual([sum('rqt'), sum('rch'), sum('rsl')], [2, 1, 2])
})

// ── keeping what the customer could not change ────────────────────────────────────────────────────────────────────
const SEED_Q = () => ({
  mfr: 'CCI',
  fields: {
    btype: 'standard', bw: '24', bl: '30', bh: '14', rs: 'Vertical', 'pitch-sel': '6:12', ws: 'Horizontal', zip: '33411', county: 'Palm Beach',
    wfg: 'Closed', wbg: 'Closed', wle: '1_5panel', wre: 'Closed', cr: '#C47F2A', cw: '#8A8A88', ct: '#1D1E20', wain: 'no',
    lap: 'yes', 'overhang-sel': '1ft-all', 'add-end-wall': 'yes', 'aew-end': 'back', 'aew-depth': '10',
    pt: 'res', perm: 'yes', 'plans-sel': 'Generic Plans', 'permit-svc': 'building', foundation: 'concrete', 'delivery-type': 'installed', notes: 'gate code 1234',
    disc: '5', 'adj-amt': '250', 'adj-note': 'match', 'cert-ovr': '150', 'hold-amt': '40000',
  },
  doors: [
    { rloc: 'Front Gable End', rdtype: 'rollup', rsz: '10x10', rqt: '1', rch: '1', rsl: '1', rop: '1', r45: 'no', rco: 'white', positions: [{ val: '7', side: 'left' }] },
    { rloc: 'Partition Wall', rdtype: 'rollup', rsz: '8x8', rqt: '1', rch: '0', rsl: '0', rop: '0', r45: 'no', rco: 'white', positions: [{ val: '8', side: 'left' }] },
  ],
  wtds: [{ wloc: 'Left Eave Side', whi: 'std', wqt: '1', wsf: '1', positions: [{ val: '6', side: 'left' }] }],
  windows: [{ nloc: 'Left Eave Side', ntp: 'std', nqt: '1', nsf: '1', nsill: '3', positions: [{ val: '14', side: 'left' }] }],
  addcomps: [
    { act: 'Framed Opening — Window (Custom Size)', acq: '1', 'fo-loc': 'Right Eave Side', 'fo-unit': 'in', 'fo-cw': '38', 'fo-ch': '39', 'fo-sill': '3.5', acp: '150', positions: [{ val: '20', side: 'left' }] },
    { act: 'Gutters', acq: '2' },
    { act: 'Custom — see notes', acq: '1', acp: '500' },
  ],
  leantos: [],
  overrides: { fu14: true },
})

// the design a link made from SEED_Q showed (an OLD link: before the page had hoists / seals / 6:12)
function oldLink() {
  const r = quoteToSeed(SEED_Q())
  assert.ok(r.ok, r.reason)
  const sd = JSON.parse(JSON.stringify(r.seed.design))
  sd.pitch = '5:12' // the old page showed 6:12 as 5:12
  for (const o of sd.openings) { delete o.hoist; delete o.seal }
  return { sd, notes: [...r.notes, 'Roof pitch 6:12 is not on the page: shown as 5:12.', 'Door options (chain hoist, brush seal, side frames, opener choice) are not on the page.'] }
}

test('kept: lap siding, overhang, storage section + its doors, other components, job settings, the rep\'s colors / pitch / walls, door details', () => {
  const { sd, notes } = oldLink()
  const d = JSON.parse(JSON.stringify(sd)) // the customer sent it back unchanged
  const r = ok(designToQuote(env(d), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd, seedNotes: notes, seedQuoteNumber: 'SS-2026-21187' }))
  const f = r.payload.fields
  assert.equal(f.lap, 'yes')
  assert.equal(f['overhang-sel'], '1ft-all')
  assert.deepEqual([f['add-end-wall'], f['aew-end'], f['aew-depth']], ['yes', 'back', '10'])
  assert.deepEqual([f.pt, f.perm, f['plans-sel'], f['permit-svc'], f.foundation, f['delivery-type'], f.notes], ['res', 'yes', 'Generic Plans', 'building', 'concrete', 'installed', 'gate code 1234'])
  assert.equal(f['pitch-sel'], '6:12') // the old link showed 5:12; the customer left it
  assert.equal(f.cr, '#C47F2A') // not a page color: the quote's own
  assert.equal(f.wle, '1_5panel') // not a page choice: the quote's own
  const front = r.payload.doors.find((e) => e.rloc === 'Front Gable End')
  assert.deepEqual([front.rch, front.rsl, front.rop], ['1', '1', '1'])
  assert.ok(r.payload.doors.some((e) => e.rloc === 'Partition Wall' && e.rsz === '8x8'))
  assert.equal(r.payload.wtds[0].wsf, '1')
  assert.deepEqual([r.payload.windows[0].nsf, r.payload.windows[0].nsill], ['1', '3'])
  const fo = r.payload.addcomps.find((e) => /Window \(Custom Size\)/.test(e.act))
  assert.deepEqual([fo['fo-sill'], fo['fo-unit'], fo['fo-cw'], fo['fo-ch']], ['3.5', 'in', '38', '39'])
  assert.ok(r.payload.addcomps.some((e) => e.act === 'Gutters' && e.acq === '2'))
  // never a price
  const all = JSON.stringify(r.payload)
  for (const k of ['"acp"', '"disc"', '"adj-amt"', '"hold-amt"', '"cert-ovr"', '"overrides"', 'Custom — see notes']) assert.ok(!all.includes(k), `${k} leaked`)
  const t = text(r)
  assert.match(t, /Kept from quote #SS-2026-21187/)
  assert.match(t, /Not kept from quote #SS-2026-21187 — add again if it still applies: .*Custom — see notes \(a typed price/)
  assert.match(t, /a 5% discount, a price adjustment \(\$250, “match”\)/)
  assert.match(t, /wind certification set to 150 MPH/)
  assert.match(t, /framed opening Window \(Custom Size\): its typed price/)
  assert.match(t, /rep overrides/)
  // the seed notes it answered are not repeated
  assert.ok(!/had things the design page cannot show — add them again if they still apply: .*(Lap siding|6:12|Door options)/.test(t))
})

test('the customer\'s changes win: a changed color, pitch, wall or door is the customer\'s', () => {
  const { sd } = oldLink()
  const d = JSON.parse(JSON.stringify(sd))
  d.pitch = '4:12'
  d.colors.roof = 'black'
  d.walls.left = 'open'
  d.openings = d.openings.filter((o) => o.kind !== 'window') // the window removed
  d.openings.find((o) => o.kind === 'rollup' && o.wall === 'front').w = 12 // the door made wider
  const r = ok(designToQuote(env(settleDesign(d, false)), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd }))
  const f = r.payload.fields
  assert.equal(f['pitch-sel'], '4:12')
  assert.equal(f.cr, '#1D1E20')
  assert.equal(f.wle, 'Open')
  const front = r.payload.doors.find((e) => e.rloc === 'Front Gable End')
  assert.deepEqual([front.rsz, front.rch, front.rsl, front.rop], ['12x10', '0', '0', '1']) // openers: the page's one yes/no is still on
  assert.equal(r.payload.windows.length, 0)
  const t = text(r)
  assert.match(t, /details on doors \/ windows the customer changed or removed — 10x10 roll-up \(front\): chain hoist, brush seal/)
  assert.match(t, /window \(left\): side frame, height off the floor 3′/)
})

test('a new link (the page shows hoists / seals): the customer\'s ticks win, an untick stays off', () => {
  const r0 = quoteToSeed(SEED_Q())
  const sd = r0.seed.design
  assert.equal(sd.openings.find((o) => o.kind === 'rollup' && o.wall === 'front').hoist, true)
  const d = JSON.parse(JSON.stringify(sd))
  delete d.openings.find((o) => o.kind === 'rollup' && o.wall === 'front').hoist // the customer unticked it
  const r = ok(designToQuote(env(settleDesign(d, false)), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd }))
  const front = r.payload.doors.find((e) => e.rloc === 'Front Gable End')
  assert.deepEqual([front.rch, front.rsl], ['0', '1'])
})

test('another ZIP: permits / delivery are not copied (county rules); a CA quote keeps nothing; no seed quote = as before', () => {
  const { sd } = oldLink()
  const r = ok(designToQuote(env(JSON.parse(JSON.stringify(sd)), { zip: '33801', county: 'Polk', impact: false }), { zip: '33801', seedPayload: SEED_Q(), seedDesign: sd }))
  assert.ok(!('perm' in r.payload.fields) && !('delivery-type' in r.payload.fields))
  assert.equal(r.payload.fields.foundation, 'concrete') // not a county rule
  assert.match(text(r), /permits \/ plans and delivery \(the job site’s ZIP is not the quote’s/)
  const ca = SEED_Q(); ca.mfr = 'CA'
  const r2 = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedPayload: ca, seedDesign: sd, seedNotes: ['Lap siding is not on the page.'] }))
  assert.ok(!('lap' in r2.payload.fields))
  assert.match(text(r2), /other manufacturer/)
  assert.match(text(r2), /Lap siding is not on the page/) // the notes stay for a CA quote
  const r3 = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedNotes: ['Lap siding is not on the page.'] }))
  assert.ok(!('lap' in r3.payload.fields))
  assert.match(text(r3), /had things the design page cannot show — add them again if they still apply: Lap siding/)
})

test('a garage + carport now: the storage section is not kept (and said so)', () => {
  const { sd } = oldLink()
  const d = settleDesign({ ...JSON.parse(JSON.stringify(sd)), type: 'combo' }, false)
  const r = ok(designToQuote(env(d), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd }))
  assert.ok(!('add-end-wall' in r.payload.fields))
  assert.match(text(r), /the storage section \(the building is a garage \+ carport now\)/)
})

test('carryFromQuote alone: bad input is a no-op', () => {
  const p = { fields: { bw: '24' }, doors: [] }
  assert.deepEqual(carryFromQuote(p, {}).payload, p)
  assert.deepEqual(carryFromQuote(p, { seedPayload: { fields: null } }).kept, [])
  assert.deepEqual(notesLeft(['Lap siding is not on the page.', 'Width 31′ is not a page size: shown as 30′.']), ['Width 31′ is not a page size: shown as 30′.'])
})

test('what changed from the quote: hoist / seal ticks are listed', () => {
  const a = design({ openings: [{ id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white' }] })
  const b = design({ openings: [{ id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 10, sill: 0, pos: 7, color: 'white', hoist: true, seal: true }, { id: 'o2', kind: 'rollup', wall: 'back', w: 10, h: 10, sill: 0, pos: 7, color: 'white', seal: true }] })
  const lines = designDiff(env(a), env(b)).map((l) => l.text).join('\n')
  assert.match(lines, /Chain hoist added: 10×10 roll-up door/)
  assert.match(lines, /Brush seal added: 10×10 roll-up door/)
  assert.match(lines, /Added: 10×10 roll-up door with a brush seal/)
})

// ── review 10/30/26: one test per defect found ────────────────────────────────────────────────────────────────────
const CARPORT_Q = () => ({
  mfr: 'CCI', fields: { btype: 'carport', bw: '30', bl: '30', bh: '10', rs: 'Vertical', 'pitch-sel': 'standard', ws: 'Horizontal', zip: '33411', county: 'Palm Beach',
    wfg: 'Open', wbg: 'Open', wle: 'Open', wre: 'Open', 'sp-left': '2panel', 'sp-right': 'closed', cr: '#B9BCBB', cw: '#8A8A88', ct: '#1D1E20',
    lap: 'yes' },
  doors: [], wtds: [], windows: [], addcomps: [{ act: 'Gutter (per 10ft)', acq: '6' }], leantos: [],
})
const seedOf = (q) => { const r = quoteToSeed(q); assert.ok(r.ok, r.reason); return r }

test('review 1: a 30′ carport made 40′ wide (wide span) does not get the carport\'s hidden Open sides', () => {
  const r0 = seedOf(CARPORT_Q()), sd = r0.seed.design
  const d = settleDesign({ ...JSON.parse(JSON.stringify(sd)), width: 40 }, false)
  const r = ok(designToQuote(env(d), { zip: '33411', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.equal(r.payload.fields.btype, 'widespan')
  assert.equal(r.payload.fields.wle, '2panel')
  assert.equal(r.payload.fields.wre, 'Closed')
})

test('review 2: size / door dependent components are kept only on the same building with the same doors', () => {
  const r0 = seedOf(CARPORT_Q()), sd = r0.seed.design
  const same = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.ok(same.payload.addcomps.some((e) => /Gutter/.test(e.act) && e.acq === '6'))
  const longer = ok(designToQuote(env(settleDesign({ ...JSON.parse(JSON.stringify(sd)), length: 50 }, false)), { zip: '33411', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.ok(!longer.payload.addcomps.some((e) => /Gutter/.test(e.act)))
  assert.match(text(longer), /Gutter \(per 10ft\) ×6 \(the building or its doors \/ windows changed/)
  const d2 = JSON.parse(JSON.stringify(sd)); d2.walls.front = 'closed'
  d2.openings = [{ id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 8, sill: 0, pos: 10, color: 'white' }]
  const door = ok(designToQuote(env(settleDesign(d2, false)), { zip: '33411', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.ok(!door.payload.addcomps.some((e) => /Gutter/.test(e.act)))
})

test('review 3: lap siding only on the same job site (a county rule in places)', () => {
  const r0 = seedOf(CARPORT_Q()), sd = r0.seed.design
  const same = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.equal(same.payload.fields.lap, 'yes')
  const other = ok(designToQuote(env(JSON.parse(JSON.stringify(sd)), { zip: '33901', county: 'Lee', impact: false }), { zip: '33901', seedPayload: CARPORT_Q(), seedDesign: sd }))
  assert.ok(!('lap' in other.payload.fields))
  assert.match(text(other), /lap siding \(it can be a county rule/)
})

test('review 4: the storage section and its doors are kept only on the same building', () => {
  const { sd } = oldLink()
  const d = settleDesign({ ...JSON.parse(JSON.stringify(sd)), width: 20, height: 10 }, false)
  const r = ok(designToQuote(env(d), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd }))
  assert.ok(!('add-end-wall' in r.payload.fields))
  assert.ok(!r.payload.doors.some((e) => e.rloc === 'Partition Wall'))
  assert.match(text(r), /the storage section \(the building’s type or size changed/)
  assert.match(text(r), /the doors \/ windows on the storage wall/)
})

test('review 5: a choice the rep changed on the quote after the link went out stays as the customer saw it', () => {
  const q0 = SEED_Q(); q0.fields['pitch-sel'] = '4:12'; q0.fields.wle = 'Closed'
  const sd = seedOf(q0).seed.design // the link showed 4:12 and a closed left side
  const now = SEED_Q(); now.fields['pitch-sel'] = '5:12'; now.fields.wle = 'Open' // the rep edited the quote later
  const r = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedPayload: now, seedDesign: sd }))
  assert.equal(r.payload.fields['pitch-sel'], '4:12')
  assert.equal(r.payload.fields.wle, 'Closed')
  assert.match(text(r), /the quote’s newer the roof pitch, the left side wall \(the quote was changed after the link went out/)
})

test('review 6: a resized lean-to says its storage section was not kept; changed lean-to door details are listed', () => {
  const q = SEED_Q()
  q.leantos = [{ lts: 'Right Eave', ltw: '12', ltl2: '30', ltoff: '0', lth: '10', ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'enclosed', 'lt-stor': 'back', 'lt-stor-len': '10',
    accs: [{ 'lt-acc-type': 'rollup', 'lt-acc-size': '8x7', 'lt-acc-color': 'white', 'lt-acc-qty': '1', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'offset', 'lt-acc-sf': '1', 'lt-acc-ch': '0', 'lt-acc-sl': '0', offs: ['10'] }] }]
  const sd = seedOf(q).seed.design
  const d = JSON.parse(JSON.stringify(sd))
  d.leanTos[0].width = 14
  d.leanTos[0].openings[0].w = 9
  const r = ok(designToQuote(env(settleDesign(d, false)), { zip: '33411', seedPayload: q, seedDesign: sd }))
  assert.ok(!r.payload.leantos[0]['lt-stor'])
  assert.match(text(r), /the right lean-to’s storage section \(the lean-to’s size changed/)
  assert.match(text(r), /the right lean-to roll-up: side frame/)
  // left as it was: the storage section is kept
  const same = ok(designToQuote(env(JSON.parse(JSON.stringify(sd))), { zip: '33411', seedPayload: q, seedDesign: sd }))
  assert.equal(same.payload.leantos[0]['lt-stor'], 'back')
})

test('an old link where the customer ticked a hoist on another door: they answered, the quote\'s hoists do not come back', () => {
  const { sd } = oldLink()
  const d = JSON.parse(JSON.stringify(sd))
  d.openings.push({ id: 'o99', kind: 'rollup', wall: 'back', w: 8, h: 8, sill: 0, pos: 2, color: 'white', hoist: true })
  const r = ok(designToQuote(env(settleDesign(d, false)), { zip: '33411', seedPayload: SEED_Q(), seedDesign: sd }))
  const front = r.payload.doors.find((e) => e.rloc === 'Front Gable End')
  assert.deepEqual([front.rch, front.rsl], ['0', '1']) // no seal ticked anywhere: the quote's seal stays
})
