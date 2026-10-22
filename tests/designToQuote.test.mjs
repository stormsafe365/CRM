// Unit tests for "Build quote from this design" (src/lib/designToQuote.js). Run: npm test
//
// Owner 10/21/26: a design a customer sends from the no-price design page opens the CRM's Build Quote PRE-FILLED (CCI,
// today's pricing), with a "Check these before quoting" list for whatever the program can't take exactly as drawn.
// "We cannot be quoting people wrong": the round trips below prove the mapping loses nothing the page can hold, and the
// leak test proves no price ever goes into what is handed to the program.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteToSeed, settleDesign } from '../src/lib/designSeed.js'
import { designToQuote, designQuoteReason, restoreChecks, mergeChecks, canon, numStr, applyDesignToProgram } from '../src/lib/designToQuote.js'

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
