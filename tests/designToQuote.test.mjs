// Unit tests for "Build quote from this design" (src/lib/designToQuote.js). Run: npm test
//
// Owner 10/21/26: a design a customer sends from the no-price design page opens the CRM's Build Quote PRE-FILLED (CCI,
// today's pricing), with a "Check these before quoting" list for whatever the program can't take exactly as drawn.
// "We cannot be quoting people wrong": the round trips below prove the mapping loses nothing the page can hold, and the
// leak test proves no price ever goes into what is handed to the program.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quoteToSeed, settleDesign } from '../src/lib/designSeed.js'
import { designToQuote, designQuoteReason, designOf, restoreChecks, mergeChecks, canon, numStr, applyDesignToProgram } from '../src/lib/designToQuote.js'
import { innerDesign, ctxOf, isWebsiteDesign, adaptDesign, storageOf } from '../src/lib/designShape.js'
import { designSummary } from '../src/lib/designLinks.js'
import { designDiff } from '../src/lib/designDiff.js'

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const env = (design, ctx = { zip: null, county: null, impact: false }) => ({ schema: 'ss-web-design', v: 1, design, ctx })
const ok = (r) => { assert.ok(r.ok, r.reason); return r }
const has = (r, re) => assert.ok(r.checks.some((c) => re.test(c.text)), `${re} not in:\n${r.checks.map((c) => c.text).join('\n')}`)

// ── the design page's own sample design (3D Builder-designv2 configurator/web-customer/__tests__/sample.ts) ─────────────
// DEFAULT_DESIGN + OLD_STARTER_OPENINGS, sent as a design_requests row from a Palm Beach ZIP (the page shows the impact-rated
// walk door / window there and remembers the customer's own pick in `chosen`).
const SAMPLE_DESIGN = {
  type: 'garage', width: 24, length: 30, height: 10, enclosedLength: 20, roofStyle: 'Vertical', pitch: 'standard', panels: 'Horizontal',
  walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' },
  colors: { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' },
  wainscot: false,
  openings: [
    { id: 'o1', kind: 'rollup', wall: 'front', w: 10, h: 8, sill: 0, pos: 7, color: 'white' },
    { id: 'o2', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 6, style: 'std' },
    { id: 'o3', kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 14, style: 'std' },
  ],
  leanTos: [], wraps: [],
  upgrades: { insulation: 'none', frame12: false, oc4: false, panels26: false, colorScrews: false, openers: false, angle45: false },
}
const SAMPLE_ROW = {
  id: 'dr-1', client_id: 'c-1', name: 'Pat Customer', phone: '(561) 555-0147', email: 'pat@example.com', zip: '33411', notes: 'by the fence', status: 'new',
  design: env(settleDesign(SAMPLE_DESIGN, true), { zip: '33411', county: 'Palm Beach', impact: true }),
}

test('the page sample design (a design_requests row) -> the program fields, exactly', () => {
  assert.deepEqual(SAMPLE_ROW.design.design.openings.map((o) => [o.style, o.chosen]), [[undefined, undefined], ['hiwind', 'std'], ['hi', 'std']]) // the page's impact display
  const r = ok(designToQuote(SAMPLE_ROW.design, { zip: SAMPLE_ROW.zip, leadZip: '33411' }))
  const p = r.payload
  assert.equal(p.mfr, 'CCI')
  assert.equal(p.version, 3)
  assert.deepEqual(p.fields, {
    btype: 'standard', bw: '24', bl: '30', bh: '10', rs: 'Vertical', 'pitch-sel': 'standard', ws: 'Horizontal',
    'framing-upgrade': '14', 'oc-spacing': '5oc', 'sheeting-upgrade': 'standard', 'insul-sel': 'none', fastenerAdd: false,
    cr: '#B9BCBB', cw: '#8A8A88', ct: '#1D1E20', wain: 'no', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed',
    zip: '33411', county: 'Palm Beach', _span_county: 'Palm Beach', _span_state: 'FL',
  })
  assert.deepEqual(p.doors, [{ rloc: 'Front Gable End', rdtype: 'rollup', rsz: '10x8', rqt: '1', rch: '0', rsl: '0', rop: '0', r45: 'no', rco: 'white', positions: [{ val: '7', side: 'left' }] }])
  // the customer's own pick goes in; the program's county lock makes it impact-rated (and the rep is told - restoreChecks)
  assert.deepEqual(p.wtds, [{ wloc: 'Left Eave Side', whi: 'std', wqt: '1', positions: [{ val: '6', side: 'left' }] }])
  assert.deepEqual(p.windows, [{ nloc: 'Left Eave Side', ntp: 'std', nqt: '1', positions: [{ val: '14', side: 'left' }] }])
  assert.deepEqual([p.addcomps, p.leantos, p.ltWraps], [[], [], undefined])
  assert.equal(r.county, 'Palm Beach')
  has(r, /starting colors/)
  has(r, /Not asked on the design page/)
  assert.ok(!r.checks.some((c) => /ZIP/.test(c.text))) // same ZIP as the lead: nothing to say
  // a lead with another ZIP: the design's wins, with a note; no ZIP anywhere: a warning
  has(ok(designToQuote(SAMPLE_ROW.design, { zip: '33411', leadZip: '33801' })), /sent the design with ZIP 33411; the lead has ZIP 33801/)
  const noZip = ok(designToQuote(env(SAMPLE_DESIGN), {}))
  assert.equal(noZip.payload.fields.zip, '')
  assert.ok(noZip.checks[0].level === 'warn' && /No ZIP/.test(noZip.checks[0].text))
})

test('refuses what is not a page design', () => {
  assert.equal(designToQuote(null).ok, false)
  assert.equal(designToQuote({}).ok, false)
  assert.equal(designToQuote({ schema: 'something-else', design: SAMPLE_DESIGN }).ok, false)
  assert.equal(designToQuote(env({ ...SAMPLE_DESIGN, type: 'barn' })).ok, false)
  assert.match(designQuoteReason({ schema: 'x' }), /not from the customer design page/)
  assert.equal(designQuoteReason(SAMPLE_ROW.design), '')
  assert.equal(designToQuote(SAMPLE_DESIGN).ok, true) // a bare design works too
})

// ── never a price ────────────────────────────────────────────────────────────────────────────────────────────────────
const PRICE_KEYS = ['priced', 'totals', 'price_history', 'overrides', 'sessionEdits', 'inputMode', 'tax', 'disc', 'add-disc', 'add-disc-type', 'add-disc-show', 'add-disc-valid',
  'adj-amt', 'adj-type', 'adj-note', 'adj-on-h', 'acp', 'hold-amt', 'hold-ref', 'hold-src', 'hold-dec', 'base-override', 'total_amount', 'deposit_amount', 'quote_number', 'cn', 'cp', 'ce', 'notes', 'rep']
const keysOf = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach((x) => keysOf(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) } return out }

// a random design the page could send (any input, settled by the page's own rules)
function randomDesign(R, { lossless = false } = {}) {
  const pick = (a) => a[Math.floor(R() * a.length)]
  const type = pick(['garage', 'garage', 'carport', 'combo'])
  const width = type === 'combo' || R() < 0.75 ? 12 + Math.floor(R() * 19) : 32 + Math.floor(R() * 29)
  const length = 20 + Math.floor(R() * 81)
  const height = pick(width >= 32 ? [8, 9, 10, 12, 14, 16, 18, 20] : [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20])
  const sideVals = ['closed', 'open', '1panel', '2panel', '3panel', 'q1', 'q2', 'q3'].filter((v) => !/^\dpanel$/.test(v) || parseInt(v, 10) * 3 < height)
  const walls = { front: pick(['closed', 'open', 'gableOnly', 'halfClosed']), back: pick(['closed', 'closed', 'open', 'gableOnly']), left: pick(sideVals), right: pick(sideVals) }
  const kinds = lossless ? ['rollup', 'walk', 'window', 'frame'] : ['rollup', 'walk', 'window', 'frame', 'frame']
  const openings = []
  const mainWalls = type === 'combo' ? ['back', 'left', 'right', 'partition'] : ['front', 'back', 'left', 'right']
  for (let i = 0, n = Math.floor(R() * 7); i < n; i++) {
    const kind = pick(kinds)
    const wall = pick(mainWalls)
    const o = { id: `o${i + 1}`, kind, wall, pos: Math.floor(R() * 20) + 1 }
    if (kind === 'rollup') { o.w = pick([6, 8, 9, 10, 12]); o.h = pick([6, 7, 8, 10]); o.color = pick(['white', 'barnRed', 'black', 'kingBlue']) }
    if (kind === 'walk') o.style = pick(['std', '6panel_blk', '9lite', 'diamond', 'hiwind'])
    if (kind === 'window') o.style = pick(['std', 'w3036', 'b3030', 'b3036', 'hw', 'hi', 'hi3036'])
    if (kind === 'frame') {
      o.frame = pick(['door', 'window'])
      if (lossless) { const s = o.frame === 'window' ? pick([[2.5, 2.5], [4, 3], [5, 4]]) : pick([[3, 6.67], [10, 8], [12, 8], [14, 8], [16, 8]]); o.w = s[0]; o.h = s[1] }
      else { o.w = pick([3, 4, 5, 8, 10, 12, 18]); o.h = pick([2.5, 3, 6.67, 7, 8, 10]) }
    }
    openings.push(o)
  }
  const leanTos = []
  const sides = ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable'].filter(() => R() < 0.35)
  sides.forEach((side, i) => {
    const ops = []
    const enclosure = pick(['open', 'enclosed', 'custom'])
    if (enclosure !== 'open' || !lossless) {
      for (let j = 0, n = Math.floor(R() * 3); j < n; j++) {
        const kind = pick(['rollup', 'walk', 'window', 'frame'])
        const o = { id: `lo${i}${j}`, kind, wall: pick(['outer', 'front', 'back']), pos: Math.floor(R() * 6) + 1 }
        if (kind === 'rollup') { o.w = pick([6, 8, 9]); o.h = pick([6, 7]); o.color = pick(['white', 'evergreen']) }
        if (kind === 'walk') o.style = pick(['std', 'std_blk'])
        if (kind === 'window') o.style = pick(['std', 'w3036'])
        if (kind === 'frame') { o.frame = pick(['door', 'window']); o.w = o.frame === 'window' ? 2.5 : pick(lossless ? [10, 12] : [5, 10]); o.h = o.frame === 'window' ? 2.5 : 8 }
        ops.push(o)
      }
    }
    leanTos.push({ id: `lt${i + 1}`, side, width: pick([8, 10, 12, 14]), length: 10 + Math.floor(R() * 40), start: Math.floor(R() * 5), lowLeg: pick([6, 7, 8, 9, 10]), pitch: pick(['2:12', '3:12']),
      enclosure, walls: { front: pick(['open', 'closed', 'gable', 'q2']), back: pick(['open', 'closed', 'halfEnd']), side: pick(['open', 'closed', '1panel', 'q1']) }, openings: ops })
  })
  const wraps = ['FL', 'FR', 'BL', 'BR'].filter(() => R() < 0.2)
  const impact = R() < 0.25
  const d = settleDesign({
    type, width, length, height, enclosedLength: 5 + Math.floor(R() * Math.max(1, length - 10)), roofStyle: pick(['Vertical', 'Boxed Eave', 'Regular']), pitch: pick(['standard', '4:12', '5:12']),
    panels: pick(['Horizontal', 'Vertical']), walls,
    colors: { roof: pick(['galvalume', 'white', 'black', 'barn-red']), walls: pick(['pewter-gray', 'tan', 'evergreen']), trim: pick(['black', 'white']), wainscot: pick(['quaker-gray', 'print-richwood', 'clay']) },
    wainscot: R() < 0.4, openings, leanTos, wraps,
    upgrades: { insulation: pick(['none', 'roof', 'roofWalls']), frame12: R() < 0.3, oc4: R() < 0.3, angle45: R() < 0.3, panels26: R() < 0.3, colorScrews: R() < 0.3, openers: R() < 0.3 },
  }, impact)
  return { d, ctx: impact ? { zip: '33901', county: 'Lee', impact: true } : { zip: '33801', county: 'Polk', impact: false } }
}

test('never a price, a discount, tax, a hold or a contact field in what goes to the program - 400 random designs', () => {
  const R = rng(20261021)
  let lts = 0, ops = 0
  for (let i = 0; i < 400; i++) {
    const { d, ctx } = randomDesign(R)
    // a design row as the page sends it, with junk a tampered page might add
    const e = { ...env(d, ctx), priced: { total: 99999 }, totals: { total: 1 }, tax: '7', disc: '500' }
    const r = ok(designToQuote(e, { zip: ctx.zip, leadZip: '33401', seedNotes: ['A note.'] }))
    const found = PRICE_KEYS.filter((k) => keysOf(r.payload).has(k))
    assert.deepEqual(found, [], `price / contact keys in the payload: ${found}`)
    assert.doesNotMatch(JSON.stringify(r.payload), /\$|99999|"500"/)
    assert.deepEqual(Object.keys(r.payload).filter((k) => !['version', 'fields', 'mfr', 'ovl', 'doors', 'wtds', 'windows', 'addcomps', 'leantos', 'ltWraps'].includes(k)), [])
    assert.equal(r.payload.mfr, 'CCI')
    assert.doesNotMatch(r.checks.map((c) => c.text).join(' '), /\$\s?\d/) // the list for the rep names no price either
    lts += r.payload.leantos.length
    ops += r.payload.doors.length + r.payload.wtds.length + r.payload.windows.length + r.payload.addcomps.length
  }
  assert.ok(lts > 150 && ops > 600, `${lts}/${ops}`)
})

// ── round trips ──────────────────────────────────────────────────────────────────────────────────────────────────────
// The page's design survives design -> program fields -> design (what the CRM reads back when it seeds a link), for every
// random design, except the exceptions the check list names.
const kindOrder = { rollup: 0, walk: 1, window: 2, frame: 3 }
function comparable(d) {
  const x = JSON.parse(JSON.stringify(d))
  // the program lists roll-ups, walk doors, windows, framed openings in that order; ids are renumbered
  x.openings = x.openings.map((o, i) => ({ o, i })).sort((a, b) => kindOrder[a.o.kind] - kindOrder[b.o.kind] || a.i - b.i).map(({ o }) => { const y = { ...o }; delete y.id; return y })
  x.leanTos = x.leanTos.map((lt) => ({ ...lt, openings: lt.openings.map((o, i) => ({ o, i })).sort((a, b) => kindOrder[a.o.kind] - kindOrder[b.o.kind] || a.i - b.i).map(({ o }) => { const y = { ...o }; delete y.id; return y }) }))
  if (x.type !== 'combo') delete x.enclosedLength // only a garage + carport has a garage part
  if (!x.wainscot) delete x.colors.wainscot // no wainscot: its color is not on the quote (the page shows its default)
  for (const lt of x.leanTos) if (lt.enclosure !== 'custom') delete lt.walls // per-wall picks only count on a Custom lean-to (the program's too)
  return x
}

test('design -> program -> design gives the same design back (1,000 random page designs; frames and lean-to openers / 45° cuts are the named exceptions)', () => {
  const R = rng(1021)
  let n = 0, exact = 0, wideCarports = 0, ltOpeners = 0
  for (let i = 0; i < 1000; i++) {
    const { d, ctx } = randomDesign(R, { lossless: true })
    const r = ok(designToQuote(env(d, ctx), { zip: ctx.zip }))
    const back = quoteToSeed(r.payload)
    assert.ok(back.ok, back.reason)
    const a = comparable(d), b = comparable(back.seed.design)
    // a 32′+ carport is the program's Wide Span (the garage family): the walls and everything else come back
    if (d.type === 'carport' && d.width >= 32) { assert.equal(b.type, 'garage'); b.type = 'carport'; wideCarports++; has(r, /Wide Span/) }
    // openers / 45° cut on lean-to roll-ups only: the program has no place for them (named in the list)
    const mainRoll = d.openings.some((o) => o.kind === 'rollup'), ltRoll = d.leanTos.some((l) => l.openings.some((o) => o.kind === 'rollup'))
    if (!mainRoll && ltRoll && (d.upgrades.openers || d.upgrades.angle45)) {
      if (d.upgrades.openers) { has(r, /no opener choice on lean-to roll-up doors/); b.upgrades.openers = true }
      if (d.upgrades.angle45) { has(r, /main-building roll-up doors only/); b.upgrades.angle45 = true }
      ltOpeners++
    }
    // the program's 12'-30' carport has horizontal panels only: named in the list (and a printed wainscot with it)
    if (d.type === 'carport' && d.width < 32 && d.panels === 'Vertical') {
      has(r, /program’s carport panels are horizontal/); b.panels = 'Vertical'
      if (d.wainscot && /^print-/.test(d.colors.wainscot)) { has(r, /needs vertical wall panels/); b.colors.wainscot = d.colors.wainscot }
    }
    // 4' on center is standard over 24' wide (the program has no choice there): named in the list
    if (d.upgrades.oc4 && d.width > 24) { has(r, /standard on a building wider than 24′/); b.upgrades.oc4 = true }
    // an open lean-to's doors are not entered (the program hides them): named in the list
    for (const [j, lt] of d.leanTos.entries()) if (lt.enclosure === 'open' && lt.openings.length) { has(r, /is open \(no walls\) on the design/); a.leanTos[j].openings = [] }
    assert.equal(canon(b), canon(a), `design ${i}`)
    assert.equal(back.seed.ctx.impact, ctx.impact) // same impact rule from the same county
    n++
    if (canon(back.seed.design) === canon(d)) exact++
  }
  assert.ok(n === 1000 && wideCarports > 10 && ltOpeners > 0, `${n}/${wideCarports}/${ltOpeners}/${exact}`)
})

// A rep's quote that uses only what the page holds: quote -> design link -> unchanged design -> quote gives back the same
// program fields (positions as the same typed numbers, From Right turned into the From Left number of the same spot).
const PAGE_FIELDS = ['btype', 'bw', 'bl', 'bh', 'rs', 'pitch-sel', 'ws', 'wfg', 'wbg', 'wle', 'wre', 'sp-left', 'sp-right', 'gch-left', 'gch-right', 'gch-enc',
  'framing-upgrade', 'oc-spacing', 'sheeting-upgrade', 'insul-sel', 'fastenerAdd', 'cr', 'cw', 'ct', 'wain', 'zip']
const PALETTE = ['#F2F1EA', '#B9BCBB', '#1D1E20', '#57534A', '#8A8A88', '#74472A', '#2C5745', '#4A7191', '#2591CE', '#D8291D', '#A63A20', '#5C2320', '#46201F', '#B18F6C', '#A8977E', '#D2C4A0', '#DBD1B0']
const PRINTS = ['#46443F', '#B0A183', '#7A6046', '#A8A69E']
function randomQuote(R) {
  const pick = (a) => a[Math.floor(R() * a.length)]
  const btype = pick(['standard', 'standard', 'widespan', 'carport', 'gch'])
  const bw = btype === 'widespan' ? 32 + Math.floor(R() * 29) : 12 + Math.floor(R() * 19)
  const bl = 20 + Math.floor(R() * 81)
  const bh = pick(bw >= 32 ? [8, 10, 12, 14, 16] : [8, 9, 10, 12, 14])
  const wideOrLong = bw >= 32 || bl > 35
  const ws = bw >= 32 ? 'Vertical' : btype === 'carport' ? 'Horizontal' : pick(['Horizontal', 'Vertical']) // the program's own wall-style rules (doBld)
  const rs = wideOrLong ? 'Vertical' : pick(['Vertical', 'Boxed Eve', 'Regular'])
  const sides = ['1panel', '2panel', 'q1', 'q2', 'q3'].filter((v) => !/^\dpanel$/.test(v) || parseInt(v, 10) * 3 < bh)
  const f = { btype, bw: String(bw), bl: String(bl), bh: String(bh), rs, ws, 'pitch-sel': pick(['standard', '4:12', '5:12']), zip: '33801', county: 'Polk',
    'framing-upgrade': pick(['14', '12']), 'oc-spacing': bw <= 24 ? pick(['5oc', '4oc']) : '5oc', // the program resets a hidden (over 24') row to 5oc 'sheeting-upgrade': pick(['standard', 'upgrade']), 'insul-sel': rs === 'Vertical' ? pick(['none', 'roof', 'roof-walls']) : 'none',
    fastenerAdd: R() < 0.4, cr: pick(PALETTE), cw: pick(PALETTE), ct: pick(PALETTE), wain: pick(['yes', 'no']) }
  if (f.wain === 'yes') f.cwn = ws === 'Vertical' ? pick([...PALETTE, ...PRINTS]) : pick(PALETTE)
  const gable = { front: 'Front Gable End', back: 'Back Gable End', left: 'Left Eave Side', right: 'Right Eave Side' }
  let closed
  if (btype === 'gch') {
    const enc = 5 + Math.floor(R() * (bl - 10)), gl = pick(['open', 'closed', ...sides]), gr = pick(['open', 'closed', ...sides])
    Object.assign(f, { wfg: pick(['Open', 'Gable Only']), wbg: 'Closed', 'gch-enc': String(enc), 'gch-open': String(bl - enc), 'gch-left': gl, 'gch-right': gr, wle: gl === 'closed' ? 'Closed' : gl === 'open' ? 'Open' : gl, wre: gr === 'closed' ? 'Closed' : gr === 'open' ? 'Open' : gr })
    closed = ['back']
  } else if (btype === 'carport') {
    Object.assign(f, { wfg: pick(['Open', 'Closed', 'Gable Only']), wbg: pick(['Open', 'Closed']), wle: 'Open', wre: 'Open', 'sp-left': pick(['open', 'closed', ...sides]), 'sp-right': pick(['open', 'closed', ...sides]) })
    closed = ['front', 'back'].filter((k) => f[k === 'front' ? 'wfg' : 'wbg'] === 'Closed')
  } else {
    Object.assign(f, { wfg: pick(['Closed', 'Closed', 'Open', 'Half Closed']), wbg: pick(['Closed', 'Gable Only']), wle: pick(['Closed', 'Closed', 'Open', ...sides]), wre: pick(['Closed', 'Closed', ...sides]) })
    closed = ['front', 'back', 'left', 'right'].filter((k) => f[{ front: 'wfg', back: 'wbg', left: 'wle', right: 'wre' }[k]] === 'Closed')
  }
  const face = (wall) => (wall === 'left' || wall === 'right' ? bl : bw)
  const typed = (wall, w) => { const side = R() < 0.3 ? 'right' : 'left'; const v = 1 + Math.floor(R() * Math.max(1, face(wall) - w - 2)); return { val: String(v), side } }
  const q = { mfr: 'CCI', fields: f, doors: [], wtds: [], windows: [], addcomps: [], leantos: [] }
  const opener = R() < 0.4, cut = R() < 0.3
  for (const wall of closed) {
    if (R() < 0.6) { const n = 1 + Math.floor(R() * 2); const sz = pick(['8x7', '10x8', '9x8', '10x10']); const [w, h] = sz.split('x').map(Number); if (h > (wall === 'left' || wall === 'right' ? bh - 2 : bh - 1) || w > face(wall) - 2) continue
      q.doors.push({ rloc: gable[wall], rdtype: 'rollup', rsz: sz, rqt: String(n), rch: '0', rsl: '0', rop: opener ? String(n) : '0', r45: cut ? 'yes' : 'no', rco: pick(['white', 'barnRed', 'black']), positions: Array.from({ length: n }, () => typed(wall, w)) }) }
    if (R() < 0.5) q.wtds.push({ wloc: gable[wall], whi: pick(['std', '6panel', '9lite_blk', 'diamond']), wqt: '1', positions: [typed(wall, 3)] })
    if (R() < 0.5) { const n = 1 + Math.floor(R() * 3); q.windows.push({ nloc: gable[wall], ntp: pick(['std', 'w3036', 'b3030', 'hw']), nqt: String(n), positions: Array.from({ length: n }, () => typed(wall, 2.5)) }) }
    if (R() < 0.3 && face(wall) - 2 >= 12) q.addcomps.push({ act: pick(['Framed Opening — Window 30"x30"', "Framed Opening — Garage Door (12' Wide)", 'Framed Opening — Walk-Through Door 36"x80"']), acq: '1', 'fo-loc': gable[wall], positions: [typed(wall, 12)] })
  }
  if (q.doors.length === 0) for (const e of []) void e
  if (btype !== 'carport' && btype !== 'gch' && R() < 0.5) {
    const side = pick(['Left Eave', 'Back Gable'])
    const host = side === 'Left Eave' ? bl : bw
    const width = pick([8, 10, 12]), lth = [6, 7, 8].find((h) => h + (width * 2) / 12 <= bh)
    if (lth) {
      const len = Math.max(10, host - Math.floor(R() * 5))
      q.leantos.push({ lts: side, ltw: String(width), ltl2: String(len), ltoff: String(Math.min(host - len, Math.floor(R() * 3))), lth: String(lth), ltp: '2:12', 'lt-type': 'attached', 'lt-wm': 'enclosed',
        accs: [{ 'lt-acc-type': 'wtd', 'lt-acc-wtd-hi': 'std', 'lt-acc-qty': '1', 'lt-acc-loc': 'outer', 'lt-acc-pos': 'offset', offs: [String(1 + Math.floor(R() * 5))] }] })
    }
  }
  // a GCH partition door
  if (btype === 'gch' && R() < 0.5) q.doors.push({ rloc: 'Partition Wall', rdtype: 'rollup', rsz: '8x7', rqt: '1', rch: '0', rsl: '0', rop: opener ? '1' : '0', r45: cut ? 'yes' : 'no', rco: 'white', positions: [typed('front', 8)] })
  // openers / 45° cut: one yes/no on the page, so a quote that has them has them on every roll-up
  if (!q.doors.length) { /* nothing */ }
  return q
}
// the same spot as a From Left number (the page's pos) - From Right on a W-long wall at v for a w-wide part = W - v - w
function asLeft(entry, wallOf, faceOf, wOf) {
  return (entry.positions || []).map((p) => (p.side === 'right' ? faceOf(wallOf(entry)) - Number(p.val) - wOf(entry) : Number(p.val)))
}

test('a rep quote of page-only parts: quote -> design link -> unchanged design -> quote gives back the same program fields (500 random quotes)', () => {
  const R = rng(7)
  let doors = 0, lts = 0
  for (let i = 0; i < 500; i++) {
    const q = randomQuote(R)
    const s = quoteToSeed(q)
    assert.ok(s.ok, s.reason)
    const r = ok(designToQuote(s.seed, { zip: '33801' }))
    const p = r.payload
    for (const k of PAGE_FIELDS) if (k in q.fields) assert.equal(String(p.fields[k]), String(q.fields[k]), `quote ${i} field ${k}`)
    if (q.fields.wain === 'yes') assert.equal(p.fields.cwn, q.fields.cwn)
    const bw = Number(q.fields.bw), bl = Number(q.fields.bl)
    const wallOf = (loc) => ({ 'Front Gable End': 'f', 'Back Gable End': 'f', 'Partition Wall': 'f', 'Left Eave Side': 'e', 'Right Eave Side': 'e' }[loc])
    const faceOf = (k) => (k === 'e' ? bl : bw)
    const units = (list, locK, qtyK, w, extra) => list.flatMap((e) => asLeft(e, (x) => wallOf(x[locK]), faceOf, w).map((pos) => [e[locK], pos, ...extra.map((k) => e[k])]))
    const cmp = (a, b, what) => assert.deepEqual(b, a, `quote ${i} ${what}`)
    const rw = (e) => Number(String(e.rsz).split('x')[0])
    cmp(units(q.doors, 'rloc', 'rqt', rw, ['rsz', 'rco']), units(p.doors, 'rloc', 'rqt', rw, ['rsz', 'rco']), 'roll-ups')
    cmp(q.doors.map((e) => [e.rop === '0' ? 0 : 1, e.r45]), p.doors.map((e) => [e.rop === '0' ? 0 : 1, e.r45]).slice(0, q.doors.length), 'openers / 45')
    cmp(units(q.wtds, 'wloc', 'wqt', () => 3, ['whi']), units(p.wtds, 'wloc', 'wqt', () => 3, ['whi']), 'walk doors')
    cmp(units(q.windows, 'nloc', 'nqt', () => 2.5, ['ntp']), units(p.windows, 'nloc', 'nqt', () => 2.5, ['ntp']), 'windows')
    const fw = (e) => (/Window/.test(e.act) ? 2.5 : /Walk-Through/.test(e.act) ? 3 : 12)
    cmp(units(q.addcomps, 'fo-loc', 'acq', fw, ['act']), units(p.addcomps, 'fo-loc', 'acq', fw, ['act']), 'framed openings')
    cmp(q.leantos.map((l) => [l.lts, l.ltw, l.ltl2, l.ltoff, l.lth, l.ltp, l['lt-wm'], l.accs.map((a) => [a['lt-acc-type'], a['lt-acc-wtd-hi'], a['lt-acc-qty'], a['lt-acc-loc'], a.offs.map(Number)])]),
      p.leantos.map((l) => [l.lts, l.ltw, l.ltl2, l.ltoff, l.lth, l.ltp, l['lt-wm'], l.accs.map((a) => [a['lt-acc-type'], a['lt-acc-wtd-hi'], a['lt-acc-qty'], a['lt-acc-loc'], a.offs.map(Number)])]), 'lean-tos')
    // and it is the same design again
    assert.equal(canon(quoteToSeed(p).seed.design), canon(s.seed.design), `quote ${i} design`)
    doors += q.doors.length; lts += q.leantos.length
  }
  assert.ok(doors > 300 && lts > 50, `${doors}/${lts}`)
})

test('Auto-spaced openings come back as the same spots, typed (From Left)', () => {
  const q = { mfr: 'CCI', fields: { btype: 'standard', bw: '24', bl: '40', bh: '12', wfg: 'Closed', wbg: 'Closed', wle: 'Closed', wre: 'Closed' },
    doors: [{ rloc: 'Front Gable End', rsz: '10x8', rqt: '2', positions: [{ val: '' }, { val: '' }] }],
    wtds: [{ wloc: 'Left Eave Side', whi: 'std', wqt: '3', positions: [{ val: '' }, { val: '' }, { val: '' }] }] }
  const p = ok(designToQuote(quoteToSeed(q).seed)).payload
  assert.deepEqual(p.doors[0].positions, [{ val: '1.3333', side: 'left' }, { val: '12.6667', side: 'left' }]) // (24 - 20) / 3 spacing
  assert.deepEqual(p.wtds[0].positions.map((x) => x.val), ['29.25', '18.5', '7.75']) // the program's Left Eave spots, typed From Left
  assert.equal(numStr(10 / 3), '3.3333')
  assert.equal(Math.round(Number(numStr(10 / 3)) * 96) / 96, Math.round((10 / 3) * 96) / 96) // exact on the program's 1/8" grid
})

// ── what the page draws that the program can't take as drawn ─────────────────────────────────────────────────────────
test('framed openings: catalog frame-outs where they fit, custom sizes named, every one listed for the rep', () => {
  const d = settleDesign({ ...SAMPLE_DESIGN, openings: [
    { id: 'o1', kind: 'frame', frame: 'door', wall: 'front', w: 10, h: 8, sill: 0, pos: 2 },
    { id: 'o2', kind: 'frame', frame: 'door', wall: 'front', w: 8, h: 10, sill: 0, pos: 14 },
    { id: 'o3', kind: 'frame', frame: 'door', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 2 },
    { id: 'o4', kind: 'frame', frame: 'door', wall: 'left', w: 4, h: 7, sill: 0, pos: 8 },
    { id: 'o5', kind: 'frame', frame: 'door', wall: 'right', w: 18, h: 8, sill: 0, pos: 2 },
    { id: 'o6', kind: 'frame', frame: 'window', wall: 'back', w: 2.5, h: 2.5, sill: 50 / 12, pos: 2 },
    { id: 'o7', kind: 'frame', frame: 'window', wall: 'back', w: 4, h: 3, sill: 50 / 12, pos: 8 },
    { id: 'o8', kind: 'frame', frame: 'door', wall: 'left', w: 22, h: 8, sill: 0, pos: 6 },
  ] }, false)
  const r = ok(designToQuote(env(d)))
  assert.deepEqual(r.payload.addcomps.map((e) => [e.act, e['fo-loc'], e['fo-cw'], e['fo-ch'], e['fo-sill']]), [
    ["Framed Opening — Garage Door (6'-10' Wide)", 'Front Gable End', undefined, undefined, undefined],
    ["Framed Opening — Garage Door (6'-10' Wide)", 'Front Gable End', undefined, undefined, undefined],
    ['Framed Opening — Walk-Through Door 36"x80"', 'Left Eave Side', undefined, undefined, undefined],
    ['Framed Opening — Walk-Through Door 36"x80"', 'Left Eave Side', undefined, undefined, undefined],
    ["Framed Opening — Side Opening, No Door (18' Wide)", 'Right Eave Side', undefined, undefined, undefined],
    ['Framed Opening — Window 30"x30"', 'Back Gable End', undefined, undefined, '4.17'],
    ['Framed Opening — Window (Custom Size)', 'Back Gable End', '4', '3', '4.17'],
    ['Framed Opening — Custom Garage Door (Custom Size)', 'Left Eave Side', '22', '8', undefined],
  ])
  assert.ok(!keysOf(r.payload).has('acp')) // a custom size is priced by the program / typed by the rep, never here
  has(r, /8′ × 10′ framed door opening: entered as "Garage Door \(6'-10' Wide\)".*draws this catalog frame-out 10′ wide.*no height \(drawn 8′ tall\)/)
  has(r, /4′ × 7′ framed door opening: entered as the program's "Walk-Through Door 36″×80″"/)
  has(r, /18′ × 8′ framed door opening: wider than the catalog garage-door frame-outs \(16′\), entered as "Side Opening, No Door \(18′ Wide\)"/)
  has(r, /22′ × 8′ framed door opening: wider than the catalog frame-outs \(20′\).*type it if it shows \$0/)
  has(r, /4′ × 3′ framed window opening: entered as "Window \(Custom Size\)"/)
  has(r, /10′ × 8′ framed door opening.*Side Opening, No Door/)
  assert.ok(!r.checks.some((c) => /3′ × 6′8″/.test(c.text))) // the exact catalog walk-through needs no word
})

test('openers, 45° cut, open walls, open lean-tos, wraps, wide carports, seeded-link notes are all listed', () => {
  const d = settleDesign({
    ...SAMPLE_DESIGN, type: 'carport', width: 40, length: 40, height: 12, walls: { front: 'open', back: 'closed', left: 'open', right: 'closed' },
    openings: [{ id: 'o1', kind: 'rollup', wall: 'back', w: 10, h: 8, sill: 0, pos: 3, color: 'white' }, { id: 'o2', kind: 'walk', wall: 'left', w: 3, h: 80 / 12, sill: 0, pos: 6, style: 'std' }],
    leanTos: [
      { id: 'lt1', side: 'Right Eave', width: 12, length: 40, start: 0, lowLeg: 8, pitch: '2:12', enclosure: 'open', walls: { front: 'open', back: 'open', side: 'open' }, openings: [{ id: 'lo1', kind: 'walk', wall: 'outer', w: 3, h: 80 / 12, sill: 0, pos: 4, style: 'std' }] },
      { id: 'lt2', side: 'Back Gable', width: 10, length: 40, start: 0, lowLeg: 8, pitch: '2:12', enclosure: 'enclosed', walls: { front: 'open', back: 'open', side: 'open' }, openings: [{ id: 'lo2', kind: 'rollup', wall: 'outer', w: 8, h: 6, sill: 0, pos: 4, color: 'white' }] },
    ],
    wraps: ['BR'],
    upgrades: { ...SAMPLE_DESIGN.upgrades, openers: true, angle45: true },
  }, false)
  const r = ok(designToQuote(env(d), { seedNotes: ['Lap siding is not on the page.'], seedQuoteNumber: 'SS-2026-0042' }))
  const p = r.payload
  assert.equal(p.fields.btype, 'widespan')
  assert.deepEqual([p.fields.wfg, p.fields.wbg, p.fields.wle, p.fields.wre], ['Open', 'Closed', 'Open', 'Closed'])
  assert.deepEqual(p.doors.map((e) => [e.rop, e.r45]), [['1', 'yes']])
  assert.deepEqual(p.leantos.map((l) => l.accs.length), [0, 1]) // the open lean-to's door is NOT entered
  assert.equal(p.ltWraps, 'BR')
  has(r, /Wide Span/)
  has(r, /all 1 main-building roll-up door got an opener/)
  has(r, /no opener choice on lean-to roll-up doors — 1 lean-to roll-up door got none/)
  has(r, /main-building roll-up doors only — 1 lean-to roll-up door need it added by hand/)
  has(r, /Walk door \(standard white\) on the left side — that wall is not closed/)
  has(r, /Right side lean-to is open \(no walls\).*Not entered/)
  has(r, /Wrap-around corner back-right: asked for, but the lean-tos there do not qualify/)
  has(r, /started from quote #SS-2026-0042.*Lap siding is not on the page\./)
  assert.equal(r.checks.findIndex((c) => c.level === 'info') > r.checks.findLastIndex((c) => c.level === 'warn'), true) // warnings first
})

test('GCH (garage + carport): divider doors, the garage part, the carport sides', () => {
  const d = settleDesign({ ...SAMPLE_DESIGN, type: 'combo', width: 24, length: 40, height: 12, enclosedLength: 22, walls: { front: 'gableOnly', back: 'closed', left: '2panel', right: 'closed' },
    openings: [{ id: 'o1', kind: 'rollup', wall: 'partition', w: 10, h: 8, sill: 0, pos: 7, color: 'white' }, { id: 'o2', kind: 'window', wall: 'right', w: 2.5, h: 2.5, sill: 50 / 12, pos: 30, style: 'std' }] }, false)
  const p = ok(designToQuote(env(d))).payload
  assert.deepEqual([p.fields.btype, p.fields.wfg, p.fields.wbg, p.fields.wle, p.fields.wre, p.fields['gch-left'], p.fields['gch-right'], p.fields['gch-enc'], p.fields['gch-open']],
    ['gch', 'Gable Only', 'Closed', '2panel', 'Closed', '2panel', 'closed', '22', '18'])
  assert.deepEqual(p.doors.map((e) => [e.rloc, e.positions[0].val]), [['Partition Wall', '7']])
  assert.deepEqual(p.windows.map((e) => [e.nloc, e.positions[0].val]), [['Right Eave Side', '30']])
  // a carport (12'-30'): the sides are 4B Side Panels, the Section-4 rows stay Open
  const c = ok(designToQuote(env(settleDesign({ ...SAMPLE_DESIGN, type: 'carport', walls: { front: 'open', back: 'gableOnly', left: 'q2', right: 'closed' }, openings: [] }, false)))).payload
  assert.deepEqual([c.fields.btype, c.fields.wfg, c.fields.wbg, c.fields.wle, c.fields.wre, c.fields['sp-left'], c.fields['sp-right']], ['carport', 'Open', 'Gable Only', 'Open', 'Open', 'q2', 'closed'])
})

test('consecutive identical parts become one entry with a quantity, up to the program’s quantity list', () => {
  const ops = Array.from({ length: 7 }, (_, i) => ({ id: `o${i + 1}`, kind: 'window', wall: 'left', w: 2.5, h: 2.5, sill: 50 / 12, pos: 1 + i * 4, style: 'std' }))
  ops.splice(3, 0, { id: 'o9', kind: 'window', wall: 'left', w: 2.5, h: 3, sill: 50 / 12, pos: 40, style: 'w3036' })
  const d = settleDesign({ ...SAMPLE_DESIGN, length: 60, openings: ops }, false)
  const p = ok(designToQuote(env(d))).payload
  assert.deepEqual(p.windows.map((e) => [e.ntp, e.nqt, e.positions.map((x) => x.val).join(',')]), [['std', '3', '1,5,9'], ['w3036', '1', '40'], ['std', '4', '13,17,21,25']])
})

// ── the program read back ────────────────────────────────────────────────────────────────────────────────────────────
test('restoreChecks: the program’s rule locks are explained, values it refused are flagged, free upgrades noted', () => {
  const p = ok(designToQuote(SAMPLE_ROW.design, { zip: '33411' })).payload
  const back = JSON.parse(JSON.stringify(p))
  // what the program does in Palm Beach: 12 GA + 4' OC (charged), impact-rated walk door + window, free 26 GA
  back.fields['framing-upgrade'] = '12'; back.fields['oc-spacing'] = '4oc'; back.fields['sheeting-upgrade'] = 'upgrade'
  back.wtds[0].whi = 'hiwind'; back.windows[0].ntp = 'hi'
  // and a size it could not take, a position that did not take
  back.doors[0].rsz = '10x7'; back.doors[0].positions[0].val = '8'
  back.fields.lap = 'no'; back.fields['delivery-type'] = 'installed'
  const c = restoreChecks(p, back, { T: { sheetFree: true, fastenerFree: false }, county: 'Palm Beach' })
  const t = c.map((x) => `${x.level}: ${x.text}`).join('\n')
  assert.match(t, /warn: Framing: the program requires 12-gauge framing here in Palm Beach County/)
  assert.match(t, /warn: Truss spacing: the program requires 4′ on center here in Palm Beach County/)
  assert.match(t, /info: 26-gauge wall panels: included free/)
  // the program's impact swaps: one line
  assert.match(t, /info: Impact-rated by the program's county rule \(Palm Beach County\): walk doors entered impact-rated — the customer picked standard white \(left\); windows entered impact-rated — the customer picked white 30×30 \(left\)\./)
  assert.equal(c.filter((x) => /impact-rated/.test(x.text)).length, 1)
  assert.match(t, /warn: Roll-up door 10x8 \(Front Gable End\): size — the design asks "10x8", the program shows "10x7"/)
  assert.match(t, /warn: Roll-up door 10x8 \(Front Gable End\): position 1 did not take \(7 ft asked\)/)
  // identical read-back: nothing to say
  assert.deepEqual(restoreChecks(p, JSON.parse(JSON.stringify(p))), [])
  // lap siding the county adds; fasteners included free; a missing entry; no read-back at all
  const b2 = JSON.parse(JSON.stringify(p)); b2.fields.lap = 'yes'; b2.windows = []
  const p2 = { ...p, fields: { ...p.fields, fastenerAdd: true } }
  const c2 = restoreChecks(p2, { ...b2, fields: { ...b2.fields, fastenerAdd: false } }, { T: { fastenerFree: true }, county: 'Lee' }).map((x) => x.text).join('\n')
  assert.match(c2, /Lap siding: the program adds it here in Lee County/)
  assert.match(c2, /Color-match fasteners: included free/)
  assert.match(c2, /Window \(Left Eave Side\): the design has 1 entry, the program holds 0/)
  assert.equal(restoreChecks(p, null)[0].level, 'warn')
  // colors compare by hex, any case
  const b3 = JSON.parse(JSON.stringify(p)); b3.fields.cr = p.fields.cr.toLowerCase()
  assert.deepEqual(restoreChecks(p, b3), [])
})

test('loadDesignRow: the one design (with its link info), null when unreadable', async () => {
  const { loadDesignRow } = await import('../src/lib/designLinks.js')
  const calls = []
  const chain = (result) => {
    const c = { select: (cols) => { calls.push(['select', cols]); return c }, eq: (k, v) => { calls.push(['eq', k, v]); return c }, limit: async (n) => { calls.push(['limit', n]); return result } }
    return { from: (t) => { calls.push(['from', t]); return c } }
  }
  assert.deepEqual(await loadDesignRow(chain({ data: [SAMPLE_ROW], error: null }), 'dr-1'), SAMPLE_ROW)
  assert.deepEqual(calls.filter((c) => c[0] !== 'select'), [['from', 'design_requests'], ['eq', 'id', 'dr-1'], ['limit', 1]])
  assert.match(calls.find((c) => c[0] === 'select')[1], /\bdesign\b.*design_links\(kind, label\)/) // the design itself + its link (shared or not)
  assert.equal(await loadDesignRow(chain({ data: [], error: null }), 'x'), null)
  assert.equal(await loadDesignRow(chain({ data: null, error: { code: '42501', message: 'denied' } }), 'x'), null)
  assert.equal(await loadDesignRow(chain({ data: [] }), ''), null)
})

test('mergeChecks: warnings first, no repeats', () => {
  const m = mergeChecks([{ level: 'info', text: 'a' }, { level: 'warn', text: 'b' }], [{ level: 'warn', text: 'b' }, { level: 'warn', text: 'c' }])
  assert.deepEqual(m.map((x) => x.text), ['b', 'c', 'a'])
})

test('applyDesignToProgram is self-contained (the headless program check runs the very same function in the page)', () => {
  const src = applyDesignToProgram.toString()
  // only its own arguments and browser globals: no module helpers it could lose when stringified
  for (const name of ['numStr', 'isObj', 'parseZip', 'parseCounty', 'designOf', 'COLOR_HEX', 'restoreChecks']) assert.doesNotMatch(src, new RegExp(`\\b${name}\\b`))
  // and it does what the builder needs, in this order: restore, ZIP, custom-window price rule, re-price
  const calls = []
  const el = { value: '', textContent: '—' }
  const pg = {
    ZIP: { 33411: ['West Palm Beach', 'Palm Beach'] },
    restoreQuoteData: (p) => calls.push(['restore', p.fields.bw]),
    doZip: (z) => calls.push(['doZip', z]),
    onCountyEdit: () => calls.push(['onCountyEdit']),
    foAutoCustomWinPrice: () => calls.push(['winRule']),
    sy: () => calls.push(['sy']),
    rc: () => calls.push(['rc']),
    document: { getElementById: () => el, querySelectorAll: () => [{}, {}] },
  }
  applyDesignToProgram(pg, { fields: { bw: '24', zip: '33411', _span_county: 'Palm Beach' } })
  assert.deepEqual(calls, [['restore', '24'], ['doZip', '33411'], ['winRule'], ['winRule'], ['sy'], ['rc']])
  assert.equal(el.value, '33411')
  // a ZIP the program does not know keeps the design's county (doZip would blank it) and its tax rule
  calls.length = 0
  applyDesignToProgram(pg, { fields: { bw: '24', zip: '99999', _span_county: 'Lee' } })
  assert.deepEqual(calls.slice(0, 2), [['restore', '24'], ['onCountyEdit']])
  assert.equal(el.textContent, 'Lee')
})

// ── designs the WEBSITE sent (owner 10/24/26) ─────────────────────────────────────────────────────────────────────────
// "Build quote from this design" was disabled (and the card title read just "Customer design") on designs from the website's
// Customize page: it posts the page's saved-state envelope ONE LEVEL DEEPER (stormsafe-site public/customize.html, sendToCrm):
//   design = { schema:'ss-web-design', source:'website', type, width, length, height, state:{ schema, v:1, design, ctx } }
// where the design link page stores the state envelope itself (design_requests.design = { schema, v, design, ctx }).
// tests/fixtures/website-designs.json holds rows built by the website's REAL code (raw designs settled by its own
// normalizeDesign, builder-src/web-customer/src/model/normalize.ts, wrapped by its real sendToCrm). Its builder is an earlier
// fork of the page's model with its own upgrades { gauge12, oc4, vertical } and an end storage room { on, end, depth }.
const WEB = JSON.parse(readFileSync(new URL('./fixtures/website-designs.json', import.meta.url), 'utf8'))
const webRow = (id) => WEB.find((r) => r.id === id).row
const WEB_WITH_STATE = WEB.filter((r) => r.row.design.state)
/** What sendToCrm puts in design_requests.design (the first test proves this copy equals the real code's output). */
const webWrap = (state) => { const dz = state && state.design; return { schema: 'ss-web-design', source: 'website', type: dz && dz.type, width: dz && dz.width, length: dz && dz.length, height: dz && dz.height, state: state || null } }
/** The same website design as the design link page would send it: the page's upgrades, no storage room (independent of adaptDesign). */
function linkTwin(d) {
  const t = JSON.parse(JSON.stringify(d)); const u = t.upgrades
  delete t.storage
  t.upgrades = { insulation: 'none', frame12: u.gauge12 === true, oc4: u.oc4 === true, panels26: false, colorScrews: false, openers: false, angle45: false }
  return t
}
const WEB_LINE = /website’s builder/

test('website rows (the real normalizer + the real sendToCrm): the wrapper is found, the real design is inside, and its title and reason work', () => {
  assert.equal(WEB.length, 6)
  for (const { id, row } of WEB_WITH_STATE) {
    assert.deepEqual(JSON.parse(JSON.stringify(webWrap(row.design.state))), row.design, id) // the test's wrapper copy = the real code's output
    assert.equal(row.design.source, 'website')
    assert.ok(!('walls' in row.design), id) // the outer wrapper has a type and a size, but no walls: it is not the design
    assert.strictEqual(innerDesign(row.design), row.design.state.design, id)
    assert.strictEqual(designOf(row.design), row.design.state.design, id)
    assert.deepEqual(ctxOf(row.design), row.design.state.ctx, id)
    assert.ok(isWebsiteDesign(row.design), id)
    assert.equal(designQuoteReason(row.design), '', id)
    assert.match(designSummary(row.design), /^(Garage|Carport|Garage \+ Carport) \d+' × \d+' × \d+' \(W × L × H\)/, id)
    assert.ok(designToQuote(row.design, { zip: row.zip }).ok, id)
  }
  assert.equal(designSummary(webRow('garage-with-lean-tos').design), "Garage 30' × 40' × 12' (W × L × H) + 2 lean-tos")
  assert.equal(designSummary(webRow('hybrid-divider-doors').design), "Garage + Carport 24' × 50' × 12' (W × L × H)")
  assert.equal(designSummary(webRow('carport-gauge12-palm-beach').design), "Carport 20' × 40' × 12' (W × L × H)")
})

test('the design link envelope, the website wrapper and a bare design all give the same building and place', () => {
  const R = rng(1024)
  for (let i = 0; i < 30; i++) {
    const { d, ctx } = randomDesign(R)
    const link = env(d, ctx)
    const site = webWrap(link)
    for (const shape of [link, site, d]) assert.strictEqual(innerDesign(shape), d)
    assert.deepEqual(ctxOf(link), ctx); assert.deepEqual(ctxOf(site), ctx); assert.deepEqual(ctxOf(d), {})
    assert.ok(isWebsiteDesign(site)); assert.ok(!isWebsiteDesign(link)); assert.ok(!isWebsiteDesign(d))
  }
  // the wrapper's own type / size never pass for a design; junk finds nothing
  const noState = webRow('no-state').design
  assert.deepEqual([innerDesign(noState), innerDesign({ schema: 'ss-web-design', source: 'website', type: 'garage', width: 24, length: 30, height: 10, state: null })], [null, null])
  for (const junk of [null, undefined, 5, 'x', [], {}, { design: 3 }, { state: { design: {} } }, { design: { type: 'garage' } }]) assert.equal(innerDesign(junk), null)
  assert.deepEqual(ctxOf(null), {}); assert.deepEqual(ctxOf({ ctx: 5 }), {})
})

test('a website design builds the SAME quote as the same design from the design link (only the website’s own fields differ)', () => {
  for (const { id, row } of WEB_WITH_STATE) {
    const d = row.design.state.design
    const web = ok(designToQuote(row.design, { zip: row.zip }))
    const twin = ok(designToQuote(env(linkTwin(d), row.design.state.ctx), { zip: row.zip }))
    if (!d.storage.on) assert.deepEqual(web.payload, twin.payload, id)
    else {
      // the storage room: its fields and its wall's doors are added, nothing else moves
      const noRoom = ok(designToQuote(env({ ...linkTwin(d), openings: d.openings.filter((o) => o.wall !== 'partition') }, row.design.state.ctx), { zip: row.zip }))
      const p = JSON.parse(JSON.stringify(web.payload))
      for (const k of ['add-end-wall', 'aew-end', 'aew-depth']) delete p.fields[k]
      for (const [k, loc] of [['doors', 'rloc'], ['wtds', 'wloc'], ['windows', 'nloc'], ['addcomps', 'fo-loc']]) p[k] = p[k].filter((e) => e[loc] !== 'Partition Wall')
      assert.deepEqual(p, noRoom.payload, id)
    }
    assert.equal(web.county, twin.county); assert.equal(web.zip, twin.zip)
    assert.ok(web.checks.some((c) => WEB_LINE.test(c.text)), id) // says it came from the website's builder (no insulation / openers / ... asked)
    assert.ok(!web.checks.some((c) => /tidied/.test(c.text)), id + ': a valid website design is not "tidied"')
    assert.ok(!twin.checks.some((c) => WEB_LINE.test(c.text)), id)
    // never a price
    for (const k of keysOf(web.payload)) assert.ok(!PRICE_KEYS.includes(k), k)
    // no seed to compare with: no "what changed" list, no error
    assert.deepEqual(designDiff(env(linkTwin(d), row.design.state.ctx), row.design), [], id)
    assert.deepEqual(designDiff(null, row.design), [], id)
  }
})

test('website 12-gauge framing, 4′ on center, vertical panels, wainscot and print colors reach the program fields', () => {
  // 12-gauge: the website's `gauge12` is the page's `frame12` - read as 14-gauge it would be a wrong price
  const car = ok(designToQuote(webRow('carport-gauge12-palm-beach').design, { zip: '33411' }))
  assert.equal(webRow('carport-gauge12-palm-beach').design.state.design.upgrades.frame12, undefined)
  assert.deepEqual([car.payload.fields['framing-upgrade'], car.payload.fields['oc-spacing'], car.payload.fields.btype], ['12', '4oc', 'carport'])
  assert.deepEqual([car.payload.fields.wfg, car.payload.fields.wbg, car.payload.fields['sp-left'], car.payload.fields['sp-right']], ['Open', 'Gable Only', '1panel', 'open'])
  has(car, /customer picked vertical; the program’s carport panels are horizontal/)
  const g = ok(designToQuote(webRow('garage-with-lean-tos').design, { zip: '33801' }))
  assert.equal(g.payload.fields['framing-upgrade'], '14')
  assert.deepEqual([g.payload.fields.ws, g.payload.fields.wain, g.payload.fields.cwn, g.payload.fields['pitch-sel']], ['Vertical', 'yes', '#B0A183', '4:12'])
  // the wide span garage keeps everything it had (nothing asked, nothing added)
  const w = ok(designToQuote(webRow('wide-span-no-upgrades').design, { zip: '34470' }))
  assert.deepEqual([w.payload.fields.btype, w.payload.fields.bw, w.payload.fields.ws, w.payload.fields['framing-upgrade']], ['widespan', '40', 'Vertical', '14'])
  // the doors, windows, framed openings and lean-tos arrive too (the quantity run, positions, the lean-to's own parts)
  assert.deepEqual(g.payload.doors.map((e) => [e.rloc, e.rsz, e.rqt, e.rco, e.positions.map((p) => p.val)]), [['Front Gable End', '10x8', '2', 'barnRed', ['4', '16']]])
  assert.deepEqual(g.payload.leantos.map((l) => [l.lts, l.ltw, l['lt-wm'], l.accs.length]), [['Left Eave', '12', 'enclosed', 2], ['Right Eave', '10', 'custom', 0]])
  assert.equal(g.payload.addcomps[0]['fo-loc'], 'Back Gable End')
  const h = ok(designToQuote(webRow('hybrid-divider-doors').design, { zip: '32114' }))
  assert.deepEqual([h.payload.fields.btype, h.payload.fields['gch-enc'], h.payload.doors[0].rloc], ['gch', '30', 'Partition Wall'])
})

test('the website’s end storage room becomes the program’s End Storage, with the doors on its wall; the program prices it, never this file', () => {
  const row = webRow('garage-with-storage-room')
  const d = row.design.state.design
  assert.deepEqual(d.storage, { on: true, end: 'back', depth: 8 }) // asked for 10, the website's own rule snapped it to a frame line
  assert.equal(d.openings.filter((o) => o.wall === 'partition').length, 2)
  const r = ok(designToQuote(row.design, { zip: row.zip }))
  assert.deepEqual([r.payload.fields['add-end-wall'], r.payload.fields['aew-end'], r.payload.fields['aew-depth']], ['yes', 'back', '8'])
  assert.deepEqual(r.payload.wtds.find((e) => e.wloc === 'Partition Wall'), { wloc: 'Partition Wall', whi: 'hiwind', wqt: '1', positions: [{ val: '5', side: 'left' }] })
  assert.deepEqual(r.payload.windows.find((e) => e.nloc === 'Partition Wall').positions, [{ val: '14', side: 'left' }])
  has(r, /End storage room \(asked for on the website\): a partition wall 8′ in from the back end, entered as the program's End Storage \(it prices it\)\. Confirm the depth and the doors \/ windows on the storage room wall/)
  assert.ok(!r.checks.some((c) => /storage partition,/.test(c.text))) // "not asked" no longer lists the storage partition
  assert.ok(!r.checks.some((c) => /not closed on the design/.test(c.text))) // the storage wall takes openings; it is not an open wall
  assert.ok(!JSON.stringify(r.payload).match(/"(total|price|tax|disc|acp)/))
  // storage OFF on the website: nothing about a storage room, and a stray partition opening is dropped like the page drops it
  const off = JSON.parse(JSON.stringify(row.design))
  off.state.design.storage.on = false
  const r2 = ok(designToQuote(off, { zip: row.zip }))
  assert.equal(r2.payload.fields['add-end-wall'], undefined)
  assert.ok(![...r2.payload.wtds, ...r2.payload.windows].some((e) => e.wloc === 'Partition Wall' || e.nloc === 'Partition Wall'))
  assert.ok(r2.checks.some((c) => /storage partition,/.test(c.text)))
  // not on a hybrid (its divider is already the split), whatever the saved state says
  const hy = JSON.parse(JSON.stringify(webRow('hybrid-divider-doors').design))
  hy.state.design.storage = { on: true, end: 'front', depth: 10 }
  assert.equal(ok(designToQuote(hy, { zip: '32114' })).payload.fields['add-end-wall'], undefined)
  // the program's read-back: a depth it moved, or a room it did not take, is listed for the rep
  const back = JSON.parse(JSON.stringify(r.payload))
  assert.deepEqual(restoreChecks(r.payload, back), [])
  back.fields['aew-depth'] = '12'
  assert.ok(restoreChecks(r.payload, back).some((c) => c.level === 'warn' && /Storage room: the program offers the partition on its truss lines, so it set 12′ \(the nearest to the 8′ the customer drew\)/.test(c.text)))
  back.fields['add-end-wall'] = 'no'
  assert.ok(restoreChecks(r.payload, back).some((c) => /Storage room: the design asks End Storage, the program shows none/.test(c.text)))
})

test('a website row without the 3D building (the builder could not read it) says so: no button, a reason the rep can read, an empty title', () => {
  const row = webRow('no-state')
  assert.equal(row.design.state, null)
  assert.match(designQuoteReason(row.design), /The website did not send the 3D building with this one, only the spec text/)
  assert.equal(designToQuote(row.design).ok, false)
  assert.equal(designSummary(row.design), '')
  assert.deepEqual(designDiff(null, row.design), [])
  assert.match(designQuoteReason({ schema: 'ss-web-design', v: 1 }), /has no building in it/) // any other empty one keeps its wording
})

test('a design in the website wrapper builds EXACTLY the same quote as in the design link envelope (500 random page designs)', () => {
  const R = rng(20261024)
  let withParts = 0
  for (let i = 0; i < 500; i++) {
    const { d, ctx } = randomDesign(R)
    const state = env(d, ctx)
    const link = ok(designToQuote(state, { zip: ctx.zip }))
    const web = ok(designToQuote(webWrap(state), { zip: ctx.zip }))
    assert.deepEqual(web.payload, link.payload, `design ${i}`)
    assert.equal(web.county, link.county); assert.equal(web.zip, link.zip)
    // the same list for the rep, plus the one line that says where it came from
    assert.deepEqual(web.checks.filter((c) => !WEB_LINE.test(c.text)), link.checks, `design ${i}`)
    assert.equal(web.checks.length, link.checks.length + 1)
    assert.equal(designSummary(webWrap(state)), designSummary(state))
    assert.deepEqual(designDiff(state, webWrap(state)), [])
    assert.equal(designQuoteReason(webWrap(state)), designQuoteReason(state))
    if (d.openings.length && d.leanTos.length) withParts++
    // a design link page design is read exactly as before: nothing adapted, no website line
    assert.strictEqual(adaptDesign(d), d)
    assert.ok(!link.checks.some((c) => WEB_LINE.test(c.text)))
  }
  assert.ok(withParts > 20, `only ${withParts} designs with both openings and lean-tos`)
})

test('adaptDesign / storageOf: only the website’s own fields are touched', () => {
  const page = { type: 'garage', walls: {}, upgrades: { insulation: 'roof', frame12: true, oc4: false, panels26: false, colorScrews: false, openers: false, angle45: false } }
  assert.strictEqual(adaptDesign(page), page) // the SAME object: a design link page design takes no new path
  const site = adaptDesign({ type: 'carport', walls: {}, upgrades: { gauge12: true, oc4: true, vertical: true }, storage: { on: true, end: 'front', depth: 10 } })
  assert.deepEqual(site.upgrades, { insulation: 'none', angle45: false, panels26: false, colorScrews: false, openers: false, oc4: true, frame12: true })
  assert.ok(!('storage' in site) && !('vertical' in site.upgrades) && !('gauge12' in site.upgrades))
  assert.equal(adaptDesign({ type: 'garage', walls: {}, upgrades: { gauge12: false, oc4: false, vertical: false } }).upgrades.frame12, false)
  assert.equal(adaptDesign({ type: 'commercial', walls: {} }).type, 'garage') // an old saved state: the website itself settles it to an Enclosed building
  assert.equal(designQuoteReason(env({ type: 'commercial', walls: { front: 'closed', back: 'closed', left: 'closed', right: 'closed' } })), '')
  assert.equal(designQuoteReason(env({ type: 'barn', walls: {} })), 'This design has no building type.')
  assert.deepEqual(adaptDesign({ type: 'garage', walls: {}, upgrades: null }), { type: 'garage', walls: {}, upgrades: null })
  assert.equal(storageOf({ type: 'garage', storage: { on: false, end: 'front', depth: 10 } }), null)
  assert.equal(storageOf({ type: 'combo', storage: { on: true, end: 'front', depth: 10 } }), null)
  assert.equal(storageOf({ type: 'garage' }), null)
  assert.deepEqual(storageOf({ type: 'garage', storage: { on: true, end: 'front', depth: 10 } }), { end: 'front', depth: 10 })
  assert.deepEqual(storageOf({ type: 'garage', storage: { on: true, end: 'sideways', depth: 'x' } }), { end: 'back', depth: null })
  // a storage room with no usable depth still turns End Storage on (the rep sets the depth): the program picks its default
  const noDepth = JSON.parse(JSON.stringify(webRow('garage-with-storage-room').design))
  noDepth.state.design.storage.depth = null
  const r = ok(designToQuote(noDepth, { zip: '33901' }))
  assert.deepEqual([r.payload.fields['add-end-wall'], r.payload.fields['aew-end'], r.payload.fields['aew-depth']], ['yes', 'back', undefined])
  has(r, /End storage room \(asked for on the website\): a partition wall at the back end/)
})
