// designSeed: a lead's SAVED QUOTE -> the building a customer design link opens on (owner 10/20/26:
// "start sending them a link with their 3D building design (no pricing listed) but a way for them to make
// edits ... then they can click send to StormSafe Rep ... and I'd get the adjustment from them & rework
// their quote").
//
// quoteToSeed(payload, { layout, quote }) is a pure WHITELIST mapper: it reads only the building fields it
// names (never a copy of `fields`) and builds the customer page's own saved-design envelope
//   { schema: 'ss-web-design', v: 1, design, ctx: { zip, county, impact } }
// The seed is handed to the ANONYMOUS design page by its link token (migration 024, design_link_seed), so it
// never holds a price, an address, a quote number or a manufacturer, and carries ONLY the lead's name, phone and email (in `contact`): see tests/designSeed.test.mjs.
//
// The design page keeps a design inside its own build rules (web-customer/src/model/normalize.ts) on every
// load. This file carries a hand port of those rules (settleDesign) and runs the result through it, so the
// seed is stored already settled: it survives the page's normalizeDesign UNCHANGED, and a later "what changed"
// compare (designDiff.js) never shows the page's own clean-up as the customer's edit. The port was checked
// against the real normalizeDesign on tens of thousands of random quotes (see the commit message).
//
// Positions. The quote program has one definition of a typed position (posRefName) and its own
// collectElevItems() returns every opening's spot with the no-overlap model's moves applied. When the caller
// reads the quote through the program (quoteLayoutEngine.readQuoteForLayout) the spots come from there:
//   page pos = x for the front, back, right and partition walls;  length - x - w for the left eave
// (the page stores the number typed on the program's FIRST button). Without it the typed numbers are used
// (Auto-spaced openings are then recomputed from the program's closed-form spacing).
//
// Plain JS, no imports (node-testable).

export const SEED_SCHEMA = 'ss-web-design'
export const SEED_VERSION = 1
export const SEED_MAX_CHARS = 45000

// ── the page's catalogs (web-customer/src/model/catalog.ts, rules.ts) ───────────────────────────────────────
const COLORS = [
  ['white', '#F2F1EA', 'White'], ['galvalume', '#B9BCBB', 'Galvalume'], ['black', '#1D1E20', 'Black'], ['quaker-gray', '#57534A', 'Quaker Gray'],
  ['pewter-gray', '#8A8A88', 'Pewter Gray'], ['earth-brown', '#74472A', 'Earth Brown'], ['evergreen', '#2C5745', 'Evergreen'],
  ['slate-blue', '#4A7191', 'Slate Blue'], ['king-blue', '#2591CE', 'King Blue'], ['cardinal-red', '#D8291D', 'Cardinal Red'],
  ['barn-red', '#A63A20', 'Barn Red'], ['merlot', '#5C2320', 'Merlot'], ['burgundy', '#46201F', 'Burgundy'], ['tan', '#B18F6C', 'Tan'],
  ['clay', '#A8977E', 'Clay'], ['sandstone', '#D2C4A0', 'Sandstone'], ['pebble-beige', '#DBD1B0', 'Pebble Beige'],
]
const PRINTS = [
  ['print-blackwood', '#46443F', 'Black Wood print'], ['print-richwood', '#B0A183', 'Rich Wood print'],
  ['print-rusticbrick', '#7A6046', 'Rustic Brick print'], ['print-stonewall', '#A8A69E', 'Stone Wall print'],
]
const SOLID_KEYS = new Set(COLORS.map((c) => c[0]))
const PRINT_KEYS = new Set(PRINTS.map((c) => c[0]))
const BY_HEX = new Map([...COLORS, ...PRINTS].map((c) => [c[1], c[0]]))
const COLOR_NAME = new Map([...COLORS, ...PRINTS].map((c) => [c[0], c[2]]))
// colors saved before 8/25/26 (the previous palette) -> today's
const LEGACY_HEX = {
  '#F4F1EC': '#F2F1EA', '#B8BDC2': '#B9BCBB', '#1A1A1A': '#1D1E20', '#52524F': '#57534A', '#7A7D7F': '#8A8A88', '#4F3A2E': '#74472A',
  '#1F4231': '#2C5745', '#3A5E7A': '#4A7191', '#1B7AB4': '#2591CE', '#D62A1F': '#D8291D', '#A2392B': '#A63A20', '#5D2A2E': '#5C2320',
  '#4B1A23': '#46201F', '#B7986A': '#B18F6C', '#A99172': '#A8977E', '#CCBC9D': '#D2C4A0', '#D6C8A5': '#DBD1B0',
}
// the other palette's colors -> the nearest page color (chosen by name, else nearest in Lab, then judged by eye)
const ALT_COLORS = {
  '#6B6360': ['quaker-gray', 'Charcoal'], '#9EA5A8': ['pewter-gray', 'Light Gray'], '#1A1A1A': ['black', 'Black'], '#5C3A2E': ['earth-brown', 'Cocoa Brown'],
  '#C9B99A': ['sandstone', 'Light Stone'], '#EDD5C0': ['pebble-beige', 'Ivory'], '#B8956A': ['tan', 'Sahara Tan'], '#9E8880': ['clay', 'Clay'],
  '#3A6B8A': ['slate-blue', 'Hawaiian Blue'], '#7D3030': ['barn-red', 'Barn Red'], '#DDDDE8': ['white', 'Bright White'], '#CFD0C6': ['white', 'Arctic White'],
  '#1E4D3A': ['evergreen', 'Ivy Green'], '#BC1E2D': ['cardinal-red', 'Bright Red'], '#555A4A': ['quaker-gray', 'Burnished Slate'],
  '#B8BDC2': ['galvalume', 'Galvalume'], '#4A1E2A': ['burgundy', 'Burgundy'], '#C47F2A': ['tan', 'Copper Penny'],
}
const ALT_NO_MATCH = new Set(['#C47F2A'])
const ALT_EXACT = new Set(['#1A1A1A', '#B8BDC2', '#4A1E2A']) // same name and color

const ROLLUP_WIDTHS = [6, 8, 9, 10, 12, 14, 16]
const ROLLUP_HEIGHTS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
const ROLLUP_COLOR_KEYS = ['white', 'earthBrown', 'evergreen', 'pewterGray', 'barnRed', 'pebbleBeige', 'black', 'kingBlue', 'cardinalRed', 'burgundy', 'clay', 'tan', 'sandstone', 'slateBlue', 'quakerGray', 'merlot']
const WALK_KEYS = ['std', 'std_blk', '6panel', '6panel_blk', '9lite', '9lite_blk', 'diamond', 'hiwind']
const IMPACT_WALK = 'hiwind'
// key -> [width in, height in, black, impact]
const WINDOWS = { std: [30, 30, 0, 0], w3036: [30, 36, 0, 0], b3030: [30, 30, 1, 0], b3036: [30, 36, 1, 0], hw: [30, 30, 0, 0], hi: [30, 30, 0, 1], hi3036: [30, 36, 0, 1] }
const impactWindowFor = (k) => (/3036$/.test(k || '') ? 'hi3036' : 'hi')
const standardWindowFor = (k, black) => (/3036$/.test(k || '') ? (black ? 'b3036' : 'w3036') : (black ? 'b3030' : 'std'))
const WINDOW_SILL = 50 / 12
const WALK_W = 3
const WALK_H = 80 / 12

const LEANTO_WIDTHS = [8, 10, 12, 14, 16, 20]
const LEANTO_LEGS = [6, 7, 8, 9, 10, 12]
const LEANTO_PITCHES = ['2:12', '3:12']
const LEANTO_SIDES = ['Left Eave', 'Right Eave', 'Front Gable', 'Back Gable']
const LEANTO_ENDS = ['open', 'halfEnd', 'gable', 'q1', 'q2', 'q3', 'closed']
const LEANTO_SIDE_WALLS = ['open', '1panel', '2panel', '3panel', 'q1', 'q2', 'q3', 'closed']
const LEANTO_WALLS = ['outer', 'front', 'back']
const END_WALLS = ['closed', 'open', 'gableOnly', 'halfClosed']
const SIDE_WALLS = ['closed', 'open', '1panel', '2panel', '3panel', 'q1', 'q2', 'q3']
const MAIN_WALLS = ['front', 'back', 'left', 'right', 'partition']
const WRAP_KEYS = ['FL', 'FR', 'BL', 'BR']
const WRAP_SIDES = { FL: ['Left Eave', 'Front Gable'], FR: ['Right Eave', 'Front Gable'], BL: ['Left Eave', 'Back Gable'], BR: ['Right Eave', 'Back Gable'] }
const HEIGHTS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20]
const MAX_OPENINGS = 40
const MAX_LEANTO_OPENINGS = 12
const MAX_LEANTOS = 4
const CORNER_CLEAR = 1
const GAP = 1

const FL_COUNTIES = ['Alachua', 'Baker', 'Bay', 'Bradford', 'Brevard', 'Broward', 'Calhoun', 'Charlotte', 'Citrus', 'Clay', 'Collier', 'Columbia', 'DeSoto', 'Dixie', 'Duval',
  'Escambia', 'Flagler', 'Franklin', 'Gadsden', 'Gilchrist', 'Glades', 'Gulf', 'Hamilton', 'Hardee', 'Hendry', 'Hernando', 'Highlands', 'Hillsborough', 'Holmes', 'Indian River',
  'Jackson', 'Jefferson', 'Lafayette', 'Lake', 'Lee', 'Leon', 'Levy', 'Liberty', 'Madison', 'Manatee', 'Marion', 'Martin', 'Miami-Dade', 'Monroe', 'Nassau', 'Okaloosa',
  'Okeechobee', 'Orange', 'Osceola', 'Palm Beach', 'Pasco', 'Pinellas', 'Polk', 'Putnam', 'St. Johns', 'St. Lucie', 'Santa Rosa', 'Sarasota', 'Seminole', 'Sumter',
  'Suwannee', 'Taylor', 'Union', 'Volusia', 'Wakulla', 'Walton', 'Washington']

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const nearest = (v, list) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0])
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const oneOf = (v, list, d) => (list.includes(v) ? v : d)
/** The program's / page's 1/8" grid (1/96 ft). */
export const q8 = (ft) => Math.round(ft * 96) / 96 + 0
const pf = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN }
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

const squash = (s) => String(s).toLowerCase().replace(/\bcounty\b/g, '').replace(/\bsaint\b/g, 'st').replace(/[^a-z]/g, '')
const COUNTY_BY_KEY = new Map(FL_COUNTIES.map((c) => [squash(c), c]))
COUNTY_BY_KEY.set('dade', 'Miami-Dade')
/** "Palm Beach County" / "St Lucie" / "miami dade" -> the official spelling, else null. */
export function parseCounty(v) {
  const raw = String(v ?? '').trim()
  if (!raw || raw.length > 40) return null
  return COUNTY_BY_KEY.get(squash(raw)) ?? null
}
/** 5-digit ZIP at the start of a typed value, else null. */
export function parseZip(v) {
  const m = /^\s*(\d{5})/.exec(String(v ?? ''))
  return m ? m[1] : null
}

const widthOptions = (type) => {
  const out = []
  for (let w = 12; w <= 30; w++) out.push(w)
  if (type !== 'combo') for (let w = 32; w <= 60; w++) out.push(w)
  return out
}
const heightOptions = (width) => (width < 32 ? HEIGHTS : HEIGHTS.filter((h) => h >= 8))
const isEave = (wall) => wall === 'left' || wall === 'right'
const wallLength = (d, wall) => (isEave(wall) ? d.length : d.width)
const leanToIsEave = (side) => side === 'Left Eave' || side === 'Right Eave'
const leanToHost = (d, side) => (leanToIsEave(side) ? d.length : d.width)
const leanToConnH = (lt) => lt.lowLeg + (lt.width * (lt.pitch === '3:12' ? 3 : 2)) / 12
const leanToWallLength = (d, lt, wall) => (wall === 'outer' ? Math.min(lt.length, leanToHost(d, lt.side)) : lt.width)

function rollupFits(d, wall, w, h, doorsOnWall) {
  const maxH = isEave(wall) ? d.height - 2 : doorsOnWall > 1 ? d.height - 1 : d.height
  return h <= maxH + 1e-9 && w <= wallLength(d, wall) - 2 + 1e-9
}
function leanToRollupFits(lt, wall, w, h) {
  if (wall === 'outer') return h <= lt.lowLeg - 2 + 1e-9
  return w <= lt.width - 2 + 1e-9 && h <= lt.lowLeg - 1 + 1e-9
}
function fitRollup(w, h, fits) {
  const W = nearest(w, ROLLUP_WIDTHS)
  const H = nearest(h, ROLLUP_HEIGHTS)
  if (fits(W, H)) return { w: W, h: H }
  const ws = ROLLUP_WIDTHS.filter((x) => x <= W && fits(x, 6))
  const nw = ws.length ? ws[ws.length - 1] : ROLLUP_WIDTHS[0]
  const hs = ROLLUP_HEIGHTS.filter((x) => x <= H && fits(nw, x))
  return { w: nw, h: hs.length ? hs[hs.length - 1] : ROLLUP_HEIGHTS[0] }
}

function normalizeParts(o, impact, maxW, maxH, rollFits) {
  const out = { ...o }
  delete out.style; delete out.chosen; delete out.color; delete out.frame; delete out.hoist; delete out.seal
  if (o.kind === 'rollup') {
    // chain hoist / brush seal (page 10/30/26): kept only as a plain yes
    if (o.hoist === true) out.hoist = true
    if (o.seal === true) out.seal = true
    const s = fitRollup(num(o.w, 10), num(o.h, 8), rollFits)
    out.w = s.w; out.h = s.h; out.sill = 0
    out.color = ROLLUP_COLOR_KEYS.includes(o.color) ? o.color : 'white'
  } else if (o.kind === 'walk') {
    out.w = WALK_W; out.h = WALK_H; out.sill = 0
    const valid = (k) => typeof k === 'string' && WALK_KEYS.includes(k)
    const shown = valid(o.style) ? o.style : null
    let pick = valid(o.chosen) ? o.chosen : (shown ?? 'std')
    if (o.chosen && shown && shown !== IMPACT_WALK && shown !== pick) pick = shown
    out.style = impact ? IMPACT_WALK : pick
    if (impact) out.chosen = pick
  } else if (o.kind === 'window') {
    const valid = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(WINDOWS, k)
    const shown = valid(o.style) ? o.style : null
    let pick = valid(o.chosen) ? o.chosen : (shown ?? 'std')
    if (o.chosen && shown && shown !== pick && shown !== impactWindowFor(pick)) pick = WINDOWS[shown][3] ? standardWindowFor(shown, !!(WINDOWS[pick] && WINDOWS[pick][2])) : shown
    let style = pick
    if (impact && !WINDOWS[style][3]) style = impactWindowFor(style)
    if (impact) out.chosen = pick
    const t = WINDOWS[style]
    out.style = style; out.w = t[0] / 12; out.h = t[1] / 12; out.sill = WINDOW_SILL
  } else {
    out.kind = 'frame'
    out.frame = o.frame === 'window' ? 'window' : 'door'
    out.sill = out.frame === 'window' ? WINDOW_SILL : 0
    out.w = q8(clamp(num(o.w, 4), 1, Math.max(1, maxW)))
    out.h = q8(clamp(num(o.h, 7), 1, Math.max(1, maxH - out.sill)))
  }
  return out
}

function nextFreeId(prefix, used) {
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`
}
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/

function leanToReaches(d, lt, k) {
  const host = leanToHost(d, lt.side)
  if (!(host > 0) || lt.length > host) return false
  const run = Math.min(lt.length, host)
  const start = Math.max(0, Math.min(lt.start, host - run))
  const front = k === 'FL' || k === 'FR'
  const left = k === 'FL' || k === 'BL'
  const atStart = start < 1e-6
  const atEnd = Math.abs(start + run - host) < 1e-6
  if (leanToIsEave(lt.side)) return front ? atStart : atEnd
  if (lt.side === 'Front Gable') return left ? atStart : atEnd
  return left ? atEnd : atStart
}
/** The requested wrap-around corners that are drawn (the page's activeWraps). */
export function activeWraps(d) {
  return WRAP_KEYS.filter((k) => {
    if (!(d.wraps || []).includes(k)) return false
    const [sE, sG] = WRAP_SIDES[k]
    const e = d.leanTos.find((l) => l.side === sE)
    const g = d.leanTos.find((l) => l.side === sG)
    return !!(e && g && leanToReaches(d, e, k) && leanToReaches(d, g, k) && e.width === g.width && e.lowLeg === g.lowLeg && e.pitch === g.pitch)
  })
}

/**
 * Keep a design inside the page's build rules: a hand port of the page's normalizeDesign
 * (web-customer/src/model/normalize.ts), same results for the same input. `impact` = impact-rated parts shown.
 * opts.partition: keep doors / windows on the `partition` wall of a building that is not a garage + carport (the WEBSITE's
 * end storage room has a wall of its own, owner 10/24/26). Off by default: a design link page design settles exactly as before.
 */
export function settleDesign(input, impact, opts = {}) {
  const d = JSON.parse(JSON.stringify(input))
  const out = {}
  out.type = oneOf(d.type, ['garage', 'carport', 'combo'], 'garage')
  out.width = nearest(Math.round(num(d.width, 24)), widthOptions(out.type))
  out.length = clamp(Math.round(num(d.length, 30)), 20, 200)
  out.height = nearest(Math.round(num(d.height, 10)), heightOptions(out.width))
  out.enclosedLength = clamp(Math.round(num(d.enclosedLength, 20)), 5, out.length - 5)
  const wide = out.width >= 32
  out.roofStyle = out.length > 35 || wide ? 'Vertical' : oneOf(d.roofStyle, ['Vertical', 'Boxed Eave', 'Regular'], 'Vertical')
  out.pitch = oneOf(d.pitch, ['standard', '4:12', '5:12', '6:12'], 'standard')
  out.panels = wide ? 'Vertical' : oneOf(d.panels, ['Horizontal', 'Vertical'], 'Horizontal')
  const w = d.walls ?? { front: 'closed', back: 'closed', left: 'closed', right: 'closed' }
  if (out.type === 'combo') {
    out.walls = { front: w.front === 'gableOnly' ? 'gableOnly' : 'open', back: 'closed', left: oneOf(w.left, SIDE_WALLS, 'open'), right: oneOf(w.right, SIDE_WALLS, 'open') }
  } else {
    const dflt = out.type === 'carport' ? 'open' : 'closed'
    out.walls = { front: oneOf(w.front, END_WALLS, dflt), back: oneOf(w.back, END_WALLS, dflt), left: oneOf(w.left, SIDE_WALLS, dflt), right: oneOf(w.right, SIDE_WALLS, dflt) }
  }
  const solid = (k, dk) => (typeof k === 'string' && SOLID_KEYS.has(k) ? k : dk)
  const c = d.colors ?? { roof: 'galvalume', walls: 'pewter-gray', trim: 'black', wainscot: 'quaker-gray' }
  out.colors = {
    roof: solid(c.roof, 'galvalume'), walls: solid(c.walls, 'pewter-gray'), trim: solid(c.trim, 'black'),
    wainscot: typeof c.wainscot === 'string' && (SOLID_KEYS.has(c.wainscot) || PRINT_KEYS.has(c.wainscot)) && (!PRINT_KEYS.has(c.wainscot) || out.panels === 'Vertical') ? c.wainscot : 'quaker-gray',
  }
  out.wainscot = d.wainscot === true
  const u = d.upgrades ?? {}
  out.upgrades = {
    insulation: out.roofStyle === 'Vertical' ? oneOf(u.insulation, ['none', 'roof', 'roofWalls'], 'none') : 'none',
    frame12: u.frame12 === true, oc4: u.oc4 === true, angle45: u.angle45 === true, panels26: u.panels26 === true, colorScrews: u.colorScrews === true, openers: u.openers === true,
  }

  const seen = new Set()
  const mains = []
  const rawMain = Array.isArray(d.openings) ? d.openings : []
  for (const raw of rawMain.slice(0, MAX_OPENINGS)) {
    if (!raw || typeof raw !== 'object') continue
    if (!['rollup', 'walk', 'window', 'frame'].includes(raw.kind)) continue
    const wall = oneOf(raw.wall, MAIN_WALLS, 'front')
    if (raw.wall !== wall) continue
    if (wall === 'partition' && out.type !== 'combo' && !(opts && opts.partition)) continue
    if (out.type === 'combo' && wall === 'front') continue
    let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : ''
    if (!id || seen.has(id)) id = nextFreeId('o', seen)
    seen.add(id)
    const face = wallLength(out, wall)
    const onWall = rawMain.filter((o) => o && o.kind === 'rollup' && o.wall === wall).length
    const part = normalizeParts({ ...raw, id, wall }, impact, face - 2, out.height, (rw, rh) => rollupFits(out, wall, rw, rh, Math.max(1, onWall)))
    part.pos = q8(clamp(num(raw.pos, CORNER_CLEAR), 0, Math.max(0, face - part.w)))
    mains.push(part)
  }
  out.openings = mains

  const sides = new Set()
  const lts = []
  const ltIds = new Set()
  const loIds = new Set(seen)
  for (const raw of (Array.isArray(d.leanTos) ? d.leanTos : []).slice(0, MAX_LEANTOS * 2)) {
    if (!raw || typeof raw !== 'object') continue
    const side = oneOf(raw.side, LEANTO_SIDES, 'Left Eave')
    if (raw.side !== side || sides.has(side) || lts.length >= MAX_LEANTOS) continue
    sides.add(side)
    let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : ''
    if (!id || ltIds.has(id)) id = nextFreeId('lt', ltIds)
    ltIds.add(id)
    const host = leanToHost(out, side)
    const width = nearest(num(raw.width, 12), LEANTO_WIDTHS)
    const length = clamp(Math.round(num(raw.length, host)), Math.min(10, host), host)
    const pitch = oneOf(raw.pitch, LEANTO_PITCHES, '2:12')
    const legs = LEANTO_LEGS.filter((h) => leanToConnH({ lowLeg: h, width, pitch }) <= out.height + 1e-9)
    const want = nearest(num(raw.lowLeg, 8), LEANTO_LEGS)
    const lowLeg = legs.includes(want) ? want : legs.length ? legs.filter((h) => h <= want).pop() ?? legs[0] : LEANTO_LEGS[0]
    const rw = raw.walls ?? { front: 'open', back: 'open', side: 'open' }
    const lt = {
      id, side, width, length, start: clamp(Math.round(num(raw.start, 0)), 0, host - length), lowLeg, pitch,
      enclosure: oneOf(raw.enclosure, ['open', 'enclosed', 'custom'], 'open'),
      walls: { front: oneOf(rw.front, LEANTO_ENDS, 'open'), back: oneOf(rw.back, LEANTO_ENDS, 'open'), side: oneOf(rw.side, LEANTO_SIDE_WALLS, 'open') },
      openings: [],
    }
    for (const ro of (Array.isArray(raw.openings) ? raw.openings : []).slice(0, MAX_LEANTO_OPENINGS)) {
      if (!ro || typeof ro !== 'object') continue
      if (!['rollup', 'walk', 'window', 'frame'].includes(ro.kind)) continue
      const wall = oneOf(ro.wall, LEANTO_WALLS, 'outer')
      if (ro.wall !== wall) continue
      let oid = typeof ro.id === 'string' && ID_RE.test(ro.id) ? ro.id : ''
      if (!oid || loIds.has(oid)) oid = nextFreeId('lo', loIds)
      loIds.add(oid)
      const len = leanToWallLength(out, lt, wall)
      const part = normalizeParts({ ...ro, id: oid, wall }, impact, len - 2, lowLeg, (a, b) => leanToRollupFits(lt, wall, a, b))
      part.pos = q8(clamp(num(ro.pos, CORNER_CLEAR), 0, Math.max(0, len - part.w)))
      lt.openings.push(part)
    }
    lts.push(lt)
  }
  out.leanTos = lts
  out.wraps = WRAP_KEYS.filter((k) => Array.isArray(d.wraps) && d.wraps.includes(k) && WRAP_SIDES[k].every((s) => sides.has(s)))
  const anyRollup = out.openings.some((o) => o.kind === 'rollup') || out.leanTos.some((l) => l.openings.some((o) => o.kind === 'rollup'))
  if (out.upgrades.openers && !anyRollup) out.upgrades.openers = false
  if (out.upgrades.angle45 && !anyRollup) out.upgrades.angle45 = false
  return out
}

// ── notes (what the page cannot show) ───────────────────────────────────────────────────────────────────────
const WALL_NAME = { front: 'front end', back: 'back end', left: 'left side', right: 'right side', partition: 'garage/carport divider wall' }
const LT_SIDE_NAME = { 'Left Eave': 'left side', 'Right Eave': 'right side', 'Front Gable': 'front end', 'Back Gable': 'back end' }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
function ftIn(ft) {
  const e = Math.round(Number(ft) * 96) || 0
  const a = Math.abs(e), f = Math.floor(a / 96), r = a - f * 96
  return (e < 0 ? '−' : '') + (r ? `${f}′${Math.floor(r / 8)}${EIGHTHS[r % 8]}″` : `${f}′`)
}
const trimNum = (n) => String(Math.round(n * 100) / 100)
const SIDE_SHORT = { closed: 'closed', open: 'open', '1panel': '1 panel from the top (3′)', '2panel': '2 panels from the top (6′)', '3panel': '3 panels from the top (9′)', q1: '¼ closed from the top', q2: '½ closed from the top', q3: '¾ closed from the top' }
const HALF_PANEL_NAME = { '1_5panel': '1½ panels (4′6″)', '2_5panel': '2½ panels (7′6″)', '3_5panel': '3½ panels (10′6″)' }

// ── main building ───────────────────────────────────────────────────────────────────────────────────────────
const END = { Closed: 'closed', Open: 'open', 'Gable Only': 'gableOnly', 'Half Closed': 'halfClosed' }
const PAGE_SIDE_PICKS = ['1panel', '2panel', '3panel', 'q1', 'q2', 'q3']
const bandFt = (k, H) => Math.min(k.endsWith('panel') ? parseInt(k, 10) * 3 : ({ q1: 0.25, q2: 0.5, q3: 0.75 })[k] * H, H)

/** A program side-wall value -> a page side-wall value (+ a note when it had to be approximated). */
export function mapSide(v, H, where, notes) {
  v = String(v ?? 'open')
  if (v === 'Closed' || v === 'closed') return 'closed'
  if (v === 'Open' || v === 'open' || v === '') return 'open'
  let m = /^(\d)panel$/.exec(v)
  if (m) {
    if (parseInt(m[1], 10) * 3 < H) return v
    notes.add(`${cap(where)} wall: ${SIDE_SHORT[v] || v} reaches the full wall height here, shown as closed.`)
    return 'closed'
  }
  if (['q1', 'q2', 'q3'].includes(v)) return v
  m = /^(\d)_5panel$/.exec(v)
  if (!m) return 'open'
  const t = parseInt(m[1], 10) * 3 + 1.5
  let pick = 'closed'
  if (t < H) {
    const c = PAGE_SIDE_PICKS.filter((k) => !/^\dpanel$/.test(k) || parseInt(k, 10) * 3 < H).map((k) => ({ k, ft: bandFt(k, H) }))
    c.sort((a, b) => Math.abs(a.ft - t) - Math.abs(b.ft - t) || b.ft - a.ft)
    pick = c[0].k
  }
  notes.add(`${cap(where)} wall: ${HALF_PANEL_NAME[v]} is not a page choice, shown as ${SIDE_SHORT[pick]}.`)
  return pick
}

function colorKey(hex, mfr, dflt, role, notes) {
  let h = String(hex || '').toUpperCase()
  if (!h || h === 'TBD') { notes.add(`${cap(role)} color was not chosen yet on the quote: the page shows ${COLOR_NAME.get(dflt)}.`); return dflt }
  if (mfr === 'CA') {
    const a = ALT_COLORS[h]
    if (!a) { notes.add(`${cap(role)} color is not on the page: shown as ${COLOR_NAME.get(dflt)}.`); return dflt }
    if (!ALT_EXACT.has(h)) {
      notes.add(ALT_NO_MATCH.has(h)
        ? `${cap(role)} color ${a[1]} has no match on the page: shown as ${COLOR_NAME.get(a[0])}.`
        : `${cap(role)} color ${a[1]} matched to the nearest page color, ${COLOR_NAME.get(a[0])}.`)
    }
    return a[0]
  }
  if (LEGACY_HEX[h]) h = LEGACY_HEX[h]
  const k = BY_HEX.get(h)
  if (!k) { notes.add(`${cap(role)} color is not on the page: shown as ${COLOR_NAME.get(dflt)}.`); return dflt }
  return k
}

function mainUnits(payload, f, mfr, notes) {
  const gch = f.btype === 'gch'
  const units = []
  const wallOf = (loc) => {
    const l = String(loc || 'Front Gable End')
    if (l === 'Front Gable End') return { elev: 'front', web: 'front' }
    if (l === 'Partition Wall') return gch ? { elev: 'front', web: 'partition' } : { elev: 'partition', web: null }
    if (l === 'Back Gable End') return { elev: 'back', web: 'back' }
    if (l === 'Left Eave Side') return { elev: 'left', web: 'left' }
    if (l === 'Right Eave Side') return { elev: 'right', web: 'right' }
    return { elev: null, web: null }
  }
  const rows = (e) => (Array.isArray(e.positions) ? e.positions : [])
  for (const e of Array.isArray(payload.doors) ? payload.doors : []) {
    if (!isObj(e)) continue
    const sz = String(e.rsz || '10x8').split('x')
    const w = q8(pf(sz[0]) || 10), h = q8(pf(sz[1]) || 8)
    const qty = parseInt(e.rqt) || 1
    const color = mfr === 'CA' ? 'white' : ROLLUP_COLOR_KEYS.includes(e.rco) ? e.rco : 'white'
    if (mfr === 'CA' && e.rco && e.rco !== 'white') notes.add('Roll-up door colors other than white are not on the page (shown white).')
    // chain hoists / brush seals are counts on the entry (0..qty): the first that many of its doors get one on the page
    // (10/30/26). A size that comes with a hoist saves 0 and the page shows it as included.
    const hoists = Math.min(qty, parseInt(e.rch) || 0), seals = Math.min(qty, parseInt(e.rsl) || 0)
    const opens = parseInt(e.rop) || 0
    if (opens > 0 && opens < qty) notes.add('Roll-up door openers: the page has one yes/no for all roll-up doors (the quote has openers on some of them).')
    units.push({ t: 'rollup', e, qty, w, h, sill: 0, loc: e.rloc, ...wallOf(e.rloc), kind: 'rollup', color, hoists, seals, rows: rows(e) })
  }
  for (const e of Array.isArray(payload.wtds) ? payload.wtds : []) {
    if (!isObj(e)) continue
    const raw = e.whi ?? e.wtype
    const style = mfr === 'CA' ? (raw === 'hi' ? 'hiwind' : 'std') : WALK_KEYS.includes(raw) ? raw : 'std'
    if (e.wsf && e.wsf !== '0' && e.wsf !== 0) notes.add('Side frames on walk doors / windows are not on the page.')
    units.push({ t: 'wtd', e, qty: parseInt(e.wqt) || 1, w: 3, h: q8(6.67), sill: 0, loc: e.wloc, ...wallOf(e.wloc), kind: 'walk', style, rows: rows(e) })
  }
  for (const e of Array.isArray(payload.windows) ? payload.windows : []) {
    if (!isObj(e)) continue
    const raw = e.ntp ?? e.ntype
    const style = Object.prototype.hasOwnProperty.call(WINDOWS, raw) ? raw : 'std'
    if (e.nsf && e.nsf !== '0' && e.nsf !== 0) notes.add('Side frames on walk doors / windows are not on the page.')
    const sill = pf(e.nsill)
    if (Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) notes.add('Window height off the floor is fixed at 4′2″ on the page.')
    units.push({ t: 'win', e, qty: parseInt(e.nqt) || 1, w: 2.5, h: WINDOWS[style][1] / 12, sill: WINDOW_SILL, loc: e.nloc, ...wallOf(e.nloc), kind: 'window', style, rows: rows(e) })
  }
  for (const e of Array.isArray(payload.addcomps) ? payload.addcomps : []) {
    if (!isObj(e)) continue
    const act = String(e.act || '')
    if (act.indexOf('Framed Opening') < 0) continue
    const qty = parseInt(e.acq) || 1
    const wind = act.indexOf('Window') >= 0
    let w = 2.5, h = 2.5, sill = wind ? pf(e['fo-sill']) : 0
    if (wind && !(Number.isFinite(sill) && sill >= 0)) sill = 50 / 12
    if (act.indexOf('(Custom Size)') >= 0) {
      const k = e['fo-unit'] === 'in' ? 1 / 12 : 1
      const cw = pf(e['fo-cw']) * k, ch = pf(e['fo-ch']) * k
      w = cw > 0 && ch > 0 ? cw : 10; h = cw > 0 && ch > 0 ? ch : 8
    } else if (act.indexOf('Garage Door') >= 0 || act.indexOf('Side Opening') >= 0) {
      const m = act.match(/(\d+)' Wide/); w = m ? parseInt(m[1], 10) : 10; h = 8; sill = 0
    } else if (act.indexOf('Double Door') >= 0) { w = 6; h = 6.67; sill = 0 }
    else if (act.indexOf('Walk-Through') >= 0) { w = 3; h = 6.67; sill = 0 }
    if (wind && Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) notes.add('Window height off the floor is fixed at 4′2″ on the page.')
    const charge = act.indexOf('45°') >= 0 || act.indexOf('Double-Tubed') >= 0
    units.push({ t: 'fo', e, qty, w: q8(w), h: q8(h), sill: wind ? q8(sill) : 0, loc: e['fo-loc'], ...wallOf(e['fo-loc']), kind: 'frame', frame: wind ? 'window' : 'door', charge, rows: rows(e) })
  }
  return units
}

/** The typed-number position (page pos = the program's first-button number) of unit i of qty. */
function typedPos(wall, face, w, qty, i, row) {
  const raw = row && row.val != null && String(row.val).trim() !== '' ? parseFloat(row.val) : NaN
  if (Number.isFinite(raw)) {
    const val = q8(raw)
    return row.side === 'right' ? q8(face - val - w) : val
  }
  const sp = (face - qty * w) / (qty + 1)
  const x = q8(sp * (i + 1) + w * i)
  return wall === 'left' ? q8(face - x - w) : x
}

// ── the main entry point ────────────────────────────────────────────────────────────────────────────────────
const refuse = (reason) => ({ ok: false, reason })

/**
 * payload = the quote's payload_json. layout (optional) = what quoteLayoutEngine.readQuoteForLayout(payload)
 * returned (the program's own resolved opening spots). quote = the quotes row (only its number is read, for the result).
 * -> { ok:true, seed, notes:[...], quoteNumber, positions:'program'|'typed' } | { ok:false, reason }
 */
export function quoteToSeed(payload, { layout = null, quote = null, contact = null } = {}) {
  const f = payload && payload.fields
  if (!isObj(f)) return refuse('This quote has no saved building (it was entered by hand), so there is nothing to start the customer on.')
  const bt = f.btype
  if (bt === 'fslean') return refuse('A free-standing lean-to building can’t be sent as a design link (the customer page has no free-standing lean-to).')
  if (!['standard', 'widespan', 'carport', 'gch'].includes(bt)) return refuse('This quote has no building type chosen yet, so there is nothing to start the customer on.')
  const bw = pf(f.bw), bl = pf(f.bl), bh = pf(f.bh)
  if (![bw, bl, bh].every((n) => Number.isFinite(n) && n > 0)) return refuse('This quote’s width, length or height is missing.')
  if (bw > 60) return refuse(`This building is ${trimNum(bw)}′ wide; the customer page goes up to 60′ wide.`)
  if (bl > 200) return refuse(`This building is ${trimNum(bl)}′ long; the customer page goes up to 200′ long.`)
  if (bh > 20) return refuse(`This building is ${trimNum(bh)}′ tall; the customer page goes up to 20′ tall.`)

  const notes = new Set()
  // same rule as layoutFromQuote: anything that is not CCI is handled the safe way (nearest-color mapping, no impact lock)
  const mfrRaw = String(payload.mfr || '').toUpperCase()
  const mfr = mfrRaw === 'CCI' ? 'CCI' : 'CA'
  if (mfrRaw !== 'CCI' && mfrRaw !== 'CA') notes.add('The maker was not recorded on this quote: colors were matched to the nearest page color and impact-rated parts are off.')
  const type = bt === 'gch' ? 'combo' : bt === 'carport' ? 'carport' : 'garage'
  const width = Math.round(bw), length = Math.round(bl), height = Math.round(bh)
  const sw = nearest(width, widthOptions(type)), sh = nearest(height, heightOptions(sw)) // for the side-wall bands only

  // size, roof, panels
  let enclosedLength
  if (type === 'combo') {
    let e = parseInt(f['gch-enc'])
    if (!(e > 0)) {
      const o = parseInt(f['gch-open'])
      e = o > 0 ? length - o : Math.round(length * 0.6)
      notes.add('The garage part’s length was not set on the quote: the page shows 60% of the building as garage.')
    }
    enclosedLength = e
  } else enclosedLength = Math.min(20, length - 5)
  const rsWant = ({ Vertical: 'Vertical', 'Boxed Eve': 'Boxed Eave', Regular: 'Regular' })[f.rs] ?? 'Vertical'
  const pitchRaw = f['pitch-sel']
  // 6:12 is on the page since 10/30/26 (CCI). A CA quote has no 6:12 (the program hides it there).
  const pitch = ({ standard: 'standard', '4:12': '4:12', '5:12': '5:12', '6:12': '6:12' })[pitchRaw] ?? 'standard'
  const panels = f.ws === 'Vertical' ? 'Vertical' : 'Horizontal'

  // walls
  let walls
  if (type === 'garage') {
    walls = { front: END[f.wfg] ?? 'closed', back: END[f.wbg] ?? 'closed', left: mapSide(f.wle ?? 'Closed', sh, 'left side', notes), right: mapSide(f.wre ?? 'Closed', sh, 'right side', notes) }
  } else if (type === 'carport') {
    const side = (sp, w) => ((sp && sp !== 'open') ? sp : (w && w !== 'Open') ? (w === 'Closed' ? 'closed' : w) : 'open')
    walls = {
      front: END[f.wfg] ?? 'open', back: END[f.wbg] ?? 'open',
      left: mapSide(side(f['sp-left'], f.wle), sh, 'left side', notes), right: mapSide(side(f['sp-right'], f.wre), sh, 'right side', notes),
    }
  } else {
    walls = { front: f.wfg === 'Gable Only' ? 'gableOnly' : 'open', back: 'closed', left: mapSide(f['gch-left'] ?? 'open', sh, 'left side', notes), right: mapSide(f['gch-right'] ?? 'open', sh, 'right side', notes) }
    if (f.wfg === 'Closed' || f.wfg === 'Half Closed') notes.add('The front end of a garage + carport is always open on the page (the quote has it closed).')
    if (f.wbg && f.wbg !== 'Closed') notes.add('The back end of a garage + carport is always closed on the page.')
    const enc = parseInt(f['gch-enc']), opn = parseInt(f['gch-open'])
    if ((enc > 0 && enc < 5) || (opn > 0 && opn < 5)) notes.add('The garage and carport parts are at least 5′ each on the page.')
  }

  // colors
  const wainOn = f.wain === 'yes'
  const colors = {
    roof: colorKey(f.cr, mfr, 'galvalume', 'roof', notes),
    walls: colorKey(f.cw, mfr, 'pewter-gray', 'wall', notes),
    trim: colorKey(f.ct, mfr, 'black', 'trim', notes),
    wainscot: 'quaker-gray',
  }
  if (wainOn) {
    const wk = colorKey(f.cwn, mfr, 'quaker-gray', 'wainscot', notes)
    colors.wainscot = wk
    if (PRINT_KEYS.has(wk) && panels !== 'Vertical' && width < 32) { notes.add('Printed wainscot panels come on vertical wall panels only: shown as Quaker Gray.'); colors.wainscot = 'quaker-gray' }
  }

  // upgrades
  const insul = ({ none: 'none', roof: 'roof', 'roof-walls': 'roofWalls' })[f['insul-sel']] ?? 'none'
  const upgrades = {
    insulation: insul, frame12: f['framing-upgrade'] === '12', oc4: f['oc-spacing'] === '4oc', panels26: f['sheeting-upgrade'] === 'upgrade',
    colorScrews: f.fastenerAdd === true || !!(payload.priced && payload.priced.free && payload.priced.free.fastener),
    openers: (Array.isArray(payload.doors) ? payload.doors : []).some((x) => x && parseInt(x.rop) > 0),
    // the program saves the 45° angle cut per roll-up entry ('yes'); the page has one yes/no for every roll-up door
    angle45: (Array.isArray(payload.doors) ? payload.doors : []).some((x) => x && (x.r45 === 'yes' || x.r45 === '1' || x.r45 === 1 || x.r45 === true)),
  }

  // rep-side things the page has no place for
  if (type !== 'combo' && f['add-end-wall'] && f['add-end-wall'] !== 'no') notes.add('Storage section / added end wall is not on the page.')
  if (f.lap === 'yes') notes.add('Lap siding is not on the page.')
  if (f['overhang-sel'] && f['overhang-sel'] !== 'none') notes.add('The 1′ roof overhang is not on the page (it shows the standard overhang).')
  const ov = isObj(payload.overrides) ? payload.overrides : {}
  if (ov.fu14 || ov.imp || ov.lap || ov.ns) notes.add('Rep overrides on the quote (14-gauge, impact, lap siding or material-only) are not on the page.')

  const cand = { type, width, length, height, enclosedLength, roofStyle: rsWant, pitch, panels, walls, colors, wainscot: wainOn, openings: [], leanTos: [], wraps: [], upgrades }

  // ── main openings ──────────────────────────────────────────────────────────────────────────────────────────
  const L = length, Wd = width
  const lay = layout && isObj(layout.elev) && Number(layout.W) === Wd && Number(layout.L) === L ? layout : null
  const elevIdx = { front: 0, back: 0, left: 0, right: 0, partition: 0 }
  let allFromProgram = true
  let autoGuess = false // an Auto-spaced spot worked out here instead of read from the program
  const units = mainUnits(payload, f, mfr, notes)
  const mains = []
  const used = { n: 0 }
  let dropped45 = false, droppedPart = false, droppedFront = false, cappedMain = false, offWall = false
  for (const u of units) {
    // consume the program's slot for this unit (collectElevItems lists every framed opening, charges included)
    let items = null
    if (u.elev && lay) items = { arr: Array.isArray(lay.elev[u.elev]) ? lay.elev[u.elev] : [], start: elevIdx[u.elev] }
    if (u.elev) elevIdx[u.elev] += u.qty
    if (!u.web) { if (u.loc === 'Partition Wall') droppedPart = true; continue }
    if (u.charge) { dropped45 = true; continue }
    if (type === 'combo' && u.web === 'front') { droppedFront = true; continue }
    const face = u.web === 'left' || u.web === 'right' ? L : Wd
    for (let i = 0; i < u.qty; i++) {
      if (mains.length >= MAX_OPENINGS) { cappedMain = true; break }
      let pos
      const it = items ? items.arr[items.start + i] : null
      if (it && it.type === u.t && Math.abs(Number(it.w) - u.w) < 0.02 && Number.isFinite(Number(it.x))) {
        const x = Number(it.x)
        pos = u.web === 'left' ? q8(face - x - u.w) : q8(x)
      } else {
        allFromProgram = false
        if (!(u.rows[i] && String(u.rows[i].val ?? '').trim() !== '')) autoGuess = true
        pos = typedPos(u.web, face, u.w, u.qty, i, u.rows[i])
      }
      used.n += 1
      const o = { id: `o${used.n}`, kind: u.kind, wall: u.web, w: u.w, h: u.h, sill: u.sill, pos }
      if (u.kind === 'rollup') {
        o.color = u.color
        if (i < u.hoists) o.hoist = true
        if (i < u.seals) o.seal = true
      } else if (u.kind === 'walk' || u.kind === 'window') o.style = u.style
      else o.frame = u.frame
      mains.push(o)
    }
  }
  if (dropped45) notes.add('45° angle cuts and double-tubed ends are charges, not doors or windows: not on the page.')
  if (droppedPart) notes.add('Doors or windows on the storage partition wall are not on the page.')
  if (droppedFront) notes.add('Doors or windows on the front of a garage + carport are not on the page (that end is the open carport).')
  if (cappedMain) notes.add(`The page holds ${MAX_OPENINGS} doors and windows; the rest are not carried.`)
  cand.openings = mains

  // ── lean-tos ───────────────────────────────────────────────────────────────────────────────────────────────
  const loCount = { n: 0 }
  const ltRes = convertLeanTos(payload, mfr, lay, Wd, L, notes, loCount)
  cand.leanTos = ltRes.leanTos
  if (typeof payload.ltWraps === 'string' && payload.ltWraps) {
    if (mfr === 'CCI') cand.wraps = payload.ltWraps.split(',').map((s) => s.trim()).filter((k) => WRAP_KEYS.includes(k))
    else notes.add('Wrap-around corners are not on the page for this quote.')
  }

  // ── settle: the page's own rules, with the quote's impact choice ───────────────────────────────────────────
  const county = parseCounty(f.county)
  const impact = impactFor({ mfr, county, width: bw, length: bl, overrides: ov })
  if (mfr === 'CCI' && (ov.imp || (ov.grand && ov.grand.imp))) notes.add('The quote does not use impact-rated parts here (a rep override): the page shows the parts as quoted.')
  let design = settleDesign(cand, impact)
  // an opening whose size the page had to change keeps its centre
  const recentre = (list, settled) => list.map((o) => {
    const s = settled.find((x) => x.id === o.id)
    return s && Math.abs(s.w - o.w) > 1e-9 ? { ...o, pos: o.pos + (o.w - s.w) / 2 } : o
  })
  const c2 = { ...cand, openings: recentre(cand.openings, design.openings), leanTos: cand.leanTos.map((lt) => {
    const s = design.leanTos.find((x) => x.id === lt.id)
    return s ? { ...lt, openings: recentre(lt.openings, s.openings) } : lt
  }) }
  design = settleDesign(c2, impact)

  describeChanges(c2, design, notes)
  if (cand.wraps.length) {
    const act = activeWraps(design)
    const lost = cand.wraps.filter((k) => !act.includes(k))
    if (lost.length) notes.add('A wrap-around corner on the quote does not hold on the page once the lean-tos are fitted to its sizes.')
  }
  if (spacingBreaks(design)) notes.add('Some doors or windows sit where the page’s spacing rules do not allow (closer than 1′ to a corner or another opening, or in the open carport part): kept where the quote has them, and the page flags them.')
  if (design.type !== 'combo' && design.openings.some((o) => design.walls[o.wall] !== 'closed')) offWall = true
  if (offWall) notes.add('Some doors or windows are on a wall that is not fully closed: the page lists them but does not draw them.')
  if (autoGuess || ltRes.autoGuess) notes.add('Auto-spaced doors and windows were placed from the quote’s spacing rules, not read from the quote program: they may sit slightly differently.')

  const seed = {
    schema: SEED_SCHEMA, v: SEED_VERSION, design,
    ctx: { zip: parseZip(f.zip), county, impact },
  }
  const ct = cleanContact(contact)
  if (ct) seed.contact = ct
  const json = JSON.stringify(seed)
  if (json.length > SEED_MAX_CHARS) return refuse('This building is too detailed to send as a design link.')
  return { ok: true, seed, notes: [...notes], quoteNumber: (quote && quote.quote_number) || payload.quote_number || null, positions: allFromProgram && lay ? 'program' : 'typed' }
}

/**
 * The lead's name / phone / email so the page need not ask for what the rep already has (owner 10/20/26). The ONLY personal
 * fields a seed may hold. Trimmed, length-capped, markup characters out; empty or unusable values are left out.
 */
export function cleanContact(c) {
  if (!isObj(c)) return null
  const out = {}
  const name = String(c.name ?? '').replace(/[<>"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (name) out.name = name
  // a phone with letters (an extension) or other than 10-11 digits is left out, never guessed at
  const phone = String(c.phone ?? '').trim()
  const digits = phone.replace(/\D/g, '')
  if (phone.length <= 40 && /^[0-9+()\-. ]+$/.test(phone) && (digits.length === 10 || digits.length === 11)) out.phone = phone.replace(/\s+/g, ' ')
  const email = String(c.email ?? '').trim().slice(0, 160)
  if (/^[^\s@<>"`]+@[^\s@<>"`]+\.[^\s@<>"`]+$/.test(email)) out.email = email
  return Object.keys(out).length ? out : null
}

/** "name and email" - only the contact fields that are really in the seed. */
export function contactWords(contact) {
  const k = ['name', 'phone', 'email'].filter((x) => contact && contact[x])
  return k.length > 1 ? `${k.slice(0, -1).join(', ')} and ${k[k.length - 1]}` : k[0] || ''
}

const IMPACT_ALL = ['Charlotte', 'Collier', 'Hillsborough', 'Indian River', 'Lee', 'Manatee', 'Palm Beach', 'Sarasota', 'St. Lucie']
/** Impact-rated windows + walk doors shown? The program's lock (CCI only), unless the rep overrode it. */
export function impactFor({ mfr, county, width, length, overrides }) {
  if (mfr !== 'CCI') return false
  const ov = overrides || {}
  if (ov.imp || (ov.grand && ov.grand.imp)) return false
  if (county && IMPACT_ALL.includes(county)) return true
  return (county === 'Okaloosa' || county === 'Okeechobee') && width * length > 720
}

// ── lean-tos ────────────────────────────────────────────────────────────────────────────────────────────────
function normSide(v) {
  const s = String(v || '').trim()
  if (LEANTO_SIDES.includes(s)) return s
  const l = s.toLowerCase()
  if (/^left/.test(l)) return 'Left Eave'
  if (/^right/.test(l)) return 'Right Eave'
  if (/^front/.test(l)) return 'Front Gable'
  if (/^back|^rear/.test(l)) return 'Back Gable'
  return null
}

/** The program's lean-to opening x positions (ovlLtLegacyXs): `len` = the wall, `w` = the item, n of them. */
function ltLegacyXs(mode, len, w, n, offs) {
  const xs = []
  if (mode === 'offset') {
    const list = Array.isArray(offs) ? offs : []
    for (let i = 0; i < n; i++) {
      const v = list[i] !== undefined ? list[i] : list.length ? list[list.length - 1] : 0
      xs.push(q8(parseFloat(v) || 0))
    }
    return xs
  }
  let gap, sx
  if (mode === 'center') { gap = Math.max(1, len * 0.03); sx = (len - (w * n + gap * (n - 1))) / 2 }
  else if (mode === 'left') { gap = Math.max(1, len * 0.03); sx = Math.max(1, len * 0.04) }
  else if (mode === 'right') { gap = Math.max(1, len * 0.03); sx = len - (w * n + gap * (n - 1)) - Math.max(1, len * 0.04) }
  else { gap = Math.max(1, (len - w * n) / (n + 1)); sx = gap }
  for (let i = 0; i < n; i++) xs.push(q8(sx + i * (w + gap)))
  return xs
}

function convertLeanTos(payload, mfr, lay, Wd, L, notes, loCount) {
  const out = []
  const list = Array.isArray(payload.leantos) ? payload.leantos : []
  const sides = new Set()
  const geomLts = lay && lay.geom && Array.isArray(lay.geom.leanTos) ? lay.geom.leanTos : null
  list.forEach((e, idx) => {
    if (!isObj(e)) return
    const side = normSide(e.lts)
    if (String(e['lt-type'] || 'attached') === 'freestanding') {
      notes.add(`A free-standing lean-to${side ? ` (${LT_SIDE_NAME[side]})` : ''} is not on the page: the page only has lean-tos attached to the building.`)
      return
    }
    if (!side) return
    const width = pf(e.ltw), length = parseInt(e.ltl2)
    if (!(width > 0) || !(length > 0)) return
    if (sides.has(side)) { notes.add(`The page holds one lean-to per side: a second lean-to on the ${LT_SIDE_NAME[side]} is not carried.`); return }
    if (out.length >= MAX_LEANTOS) { notes.add(`The page holds ${MAX_LEANTOS} lean-tos; the rest are not carried.`); return }
    sides.add(side)
    const id = `lt${out.length + 1}`
    const wm = String(e['lt-wm'] || 'open')
    const enclosure = ['open', 'enclosed', 'custom'].includes(wm) ? wm : 'open'
    let walls = { front: 'open', back: 'open', side: 'open' }
    if (enclosure === 'custom') {
      let sw = String(e['lt-wall-side'] || 'open')
      if (sw === '4panel' || sw === '5panel') {
        notes.add(`The ${LT_SIDE_NAME[side]} lean-to’s side wall has ${sw === '4panel' ? '4' : '5'} panels from the top, which the page does not have: shown as closed.`)
        sw = 'closed'
      }
      walls = { front: oneOf(e['lt-wall-front'], LEANTO_ENDS, 'open'), back: oneOf(e['lt-wall-back'], LEANTO_ENDS, 'open'), side: oneOf(sw, LEANTO_SIDE_WALLS, 'open') }
    }
    if (e['lt-stor'] === 'front' || e['lt-stor'] === 'back') notes.add('A lean-to’s storage section is not on the page.')
    const lt = {
      id, side, width, length, start: pf(e.ltoff) || 0, lowLeg: parseInt(e.lth), pitch: e.ltp, enclosure, walls, openings: [],
    }
    lt._src = { e, idx, wm }
    out.push(lt)
  })
  // openings
  let autoGuess = false
  let cappedLt = false, partDrop = false, chargeDrop = false, openDrop = false
  for (const lt of out) {
    const { e, idx, wm } = lt._src
    delete lt._src
    const accs = Array.isArray(e.accs) ? e.accs : []
    if (wm === 'open' && accs.length) { openDrop = true; continue }
    const geom = geomLts ? (geomLts.find((g) => g.n === idx + 1) || null) : null
    const gOps = geom && Array.isArray(geom.openings) ? geom.openings : null
    let gp = 0
    for (const a of accs) {
      if (!isObj(a)) continue
      const t = String(a['lt-acc-type'] || 'rollup')
      const loc = String(a['lt-acc-loc'] || 'outer')
      const qty = Math.min(24, parseInt(a['lt-acc-qty']) || 1)
      const foType = String(a['lt-acc-fo-type'] || '')
      const expect = t === 'frameout' ? 'fo' : t
      const charge = t === 'frameout' && (foType.indexOf('45') >= 0 || foType.indexOf('Double-Tubed') >= 0)
      // the program's own spots for this entry (its no-overlap model), in the order its opening list holds them
      let progXs = null
      if (gOps && gOps[gp] && gOps[gp].type === expect && gOps[gp].loc === loc && gOps[gp].qty === (parseInt(a['lt-acc-qty']) || 1)) {
        const xs = gOps[gp].xs
        if (Array.isArray(xs) && xs.length === (parseInt(a['lt-acc-qty']) || 1) && xs.every((x) => Number.isFinite(x))) progXs = xs
        gp += 1
      }
      if (charge) { chargeDrop = true; continue }
      if (loc === 'partition') { partDrop = true; continue }
      if (!LEANTO_WALLS.includes(loc)) continue
      let kind, w, h, extra = {}
      if (t === 'rollup') {
        const sz = String(a['lt-acc-size'] || '9x8').split('x')
        kind = 'rollup'; w = q8(pf(sz[0]) || 9); h = q8(pf(sz[1]) || 8)
        const c = a['lt-acc-color']
        extra = { color: mfr === 'CA' ? 'white' : ROLLUP_COLOR_KEYS.includes(c) ? c : 'white' }
        if (mfr === 'CA' && c && c !== 'white') notes.add('Roll-up door colors other than white are not on the page (shown white).')
        extra.hoists = parseInt(a['lt-acc-ch']) || 0
        extra.seals = parseInt(a['lt-acc-sl']) || 0
      } else if (t === 'wtd') {
        const raw = a['lt-acc-wtd-hi']
        kind = 'walk'; w = 3; h = q8(80 / 12)
        extra = { style: mfr === 'CA' ? (raw === 'hi' ? 'hiwind' : 'std') : WALK_KEYS.includes(raw) ? raw : 'std' }
      } else if (t === 'win') {
        const raw = a['lt-acc-win-hi']
        const style = Object.prototype.hasOwnProperty.call(WINDOWS, raw) ? raw : 'std'
        kind = 'window'; w = WINDOWS[style][0] / 12; h = WINDOWS[style][1] / 12
        extra = { style }
      } else if (t === 'frameout') {
        kind = 'frame'; w = q8(pf(a['lt-acc-fo-w']) > 0 ? pf(a['lt-acc-fo-w']) : 10); h = q8(pf(a['lt-acc-fo-h']) > 0 ? pf(a['lt-acc-fo-h']) : 10)
        extra = { frame: foType.indexOf('Window') >= 0 ? 'window' : 'door' }
        if (extra.frame === 'window') {
          const sl = pf(a['lt-acc-fo-sill'])
          if (Number.isFinite(sl) && Math.abs(sl - WINDOW_SILL) > 1 / 96 + 1e-9) notes.add('Window height off the floor is fixed at 4′2″ on the page.')
        }
      } else continue
      if (a['lt-acc-sf'] && a['lt-acc-sf'] !== '0') notes.add('Side frames on walk doors / windows are not on the page.')
      const { hoists = 0, seals = 0, ...look } = extra
      const wallLen = loc === 'outer' ? (parseInt(e.ltl2) || 0) : (parseInt(e.ltw) || 0)
      const n = parseInt(a['lt-acc-qty']) || 1
      if (!progXs && String(a['lt-acc-pos'] || 'auto') !== 'offset') autoGuess = true
      const xs = progXs || ltLegacyXs(String(a['lt-acc-pos'] || 'auto'), wallLen, w, n, a.offs)
      for (let i = 0; i < Math.min(qty, n); i++) {
        if (lt.openings.length >= MAX_LEANTO_OPENINGS) { cappedLt = true; break }
        loCount.n += 1
        const o = { id: `lo${loCount.n}`, kind, wall: loc, w, h, sill: kind === 'window' ? WINDOW_SILL : 0, pos: xs[i], ...look }
        if (kind === 'rollup' && i < hoists) o.hoist = true
        if (kind === 'rollup' && i < seals) o.seal = true
        lt.openings.push(o)
      }
    }
  }
  if (openDrop) notes.add('Doors or windows saved on a lean-to that is open (no walls) are not carried.')
  if (partDrop) notes.add('Doors or windows on a lean-to’s storage partition are not on the page.')
  if (chargeDrop) notes.add('45° angle cuts and double-tubed ends are charges, not doors or windows: not on the page.')
  if (cappedLt) notes.add(`The page holds ${MAX_LEANTO_OPENINGS} doors and windows per lean-to; the rest are not carried.`)
  return { leanTos: out, autoGuess }
}

/** Notes for what the page's rules changed when the quote's values went through them. */
function describeChanges(cand, set, notes) {
  if (cand.width !== set.width) notes.add(`Width ${cand.width}′ is not a page size: shown as ${set.width}′.`)
  if (cand.height !== set.height) notes.add(`Height ${cand.height}′ is not a page height: shown as ${set.height}′.`)
  if (cand.length !== set.length) notes.add(`Length ${cand.length}′ shown as ${set.length}′ (the page goes from 20′ to 200′).`)
  if (cand.type === 'combo' && cand.enclosedLength !== set.enclosedLength && !notes.has('The garage and carport parts are at least 5′ each on the page.')) {
    notes.add(`The garage part ${cand.enclosedLength}′ shown as ${set.enclosedLength}′.`)
  }
  if (cand.roofStyle !== set.roofStyle) notes.add(`Roof style ${cand.roofStyle} is vertical only on this building on the page: shown as vertical.`)
  if (cand.upgrades.insulation !== 'none' && set.upgrades.insulation === 'none') notes.add('Insulation goes with a vertical roof on the page: not carried here.')
  const lab = (o) => `${o.kind === 'rollup' ? `${trimNum(o.w)}×${trimNum(o.h)} roll-up door` : o.kind === 'walk' ? 'walk door' : o.kind === 'window' ? 'window' : `${trimNum(o.w)}×${trimNum(o.h)} framed opening`}`
  const cmp = (cs, ss, where) => {
    for (const o of cs) {
      const s = ss.find((x) => x.id === o.id)
      if (!s) continue
      const same = Math.abs(o.w - s.w) < 1e-6 && Math.abs(o.h - s.h) < 1e-6
      if (!same && o.kind !== 'walk' && o.kind !== 'window') notes.add(`${cap(lab(o))} (${where(o)}) shown as ${trimNum(s.w)}×${trimNum(s.h)}: the page’s size list or wall limits.`)
      if (Math.abs(o.pos - s.pos) > 1e-6 && same) notes.add(`A ${lab(o)} (${where(o)}) was moved to fit the wall.`)
    }
  }
  cmp(cand.openings, set.openings, (o) => WALL_NAME[o.wall])
  for (const lt of cand.leanTos) {
    const s = set.leanTos.find((x) => x.id === lt.id)
    if (!s) continue
    const nm = `${LT_SIDE_NAME[lt.side]} lean-to`
    if (lt.width !== s.width) notes.add(`The ${nm} width ${trimNum(lt.width)}′ shown as ${s.width}′.`)
    if (Math.round(lt.length) !== s.length) notes.add(`The ${nm} length ${trimNum(lt.length)}′ shown as ${s.length}′ (it fits its wall).`)
    if (Math.abs(lt.start - s.start) > 1e-6) notes.add(`The ${nm} start ${trimNum(lt.start)}′ shown as ${s.start}′.`)
    if (lt.lowLeg !== s.lowLeg) notes.add(`The ${nm} low leg ${lt.lowLeg}′ shown as ${s.lowLeg}′ (the page’s choices that fit under the building’s eave).`)
    if (lt.pitch !== s.pitch) notes.add(`The ${nm} pitch shown as ${s.pitch}.`)
    cmp(lt.openings, s.openings, (o) => `${nm}, ${o.wall === 'outer' ? 'outer wall' : o.wall + ' end'}`)
  }
}

/** Do any two spots break the page's 1′ corner / 1′ between rule (as the quote has them)? */
function spacingBreaks(d) {
  const bad = (items, face, blockedTo) => {
    const s = items.slice().sort((a, b) => a.pos - b.pos)
    for (let i = 0; i < s.length; i++) {
      const lo = blockedTo != null ? blockedTo + CORNER_CLEAR : CORNER_CLEAR
      if (s[i].pos < lo - 0.01 || s[i].pos + s[i].w > face - CORNER_CLEAR + 0.01) return true
      if (i && s[i].pos < s[i - 1].pos + s[i - 1].w + GAP - 0.01) return true
    }
    return false
  }
  for (const wall of MAIN_WALLS) {
    const items = d.openings.filter((o) => o.wall === wall)
    const blocked = d.type === 'combo' && isEave(wall) ? Math.max(0, d.length - d.enclosedLength) : null
    if (items.length && bad(items, wallLength(d, wall), blocked)) return true
  }
  for (const lt of d.leanTos) for (const wall of LEANTO_WALLS) {
    const items = lt.openings.filter((o) => o.wall === wall)
    if (items.length && bad(items, leanToWallLength(d, lt, wall), null)) return true
  }
  return false
}
