// designToQuote: a CUSTOMER DESIGN -> the quote program, pre-filled (owner 10/21/26: "Build quote from this design").
//
// A design_requests row holds what the customer sent from the no-price design page: `design` = the page's saved-design
// envelope { schema:'ss-web-design', v:1, design, ctx:{ zip, county, impact } } - or, from the WEBSITE's Customize page, the
// same envelope one level deeper (designShape.js reads both). designToQuote() turns it into the shape
// the quote program's own collectQuoteData() writes and restoreQuoteData() reads (fields by element id, doors, wtds,
// windows, addcomps, leantos with accs, ltWraps, mfr), so the CRM's Build Quote opens on the customer's building and the
// rep never retypes it.
//
// It is the reverse of designSeed.js (a saved quote -> the page) and uses the same map, in particular the position rule:
//   main wall:  page pos = the number typed on the program's FIRST position button (side 'left'), on every wall
//   lean-to:    page pos = the program's "Custom offset (ft from left)"
// so quote -> design link -> unchanged design -> this file gives back the same building (tests/designToQuote.test.mjs and
// the program round trip in the commit message).
//
// Rules (owner / review 10/21/26):
//   * NEVER a price. No totals, discount, tax, custom price (acp), price snapshot, hold fields, rule overrides or Pricing
//     tab edits go into the payload: the program prices the build with its own rules, its county locks included.
//   * Manufacturer = CCI (StormSafe quotes CCI; the page's catalog is the CCI catalog).
//   * Whatever the program cannot take exactly as the customer drew it is listed for the rep (`checks`), never dropped
//     silently. What the page never asks (property type, permits, foundation, delivery, chain hoists ...) is left out, so
//     the program keeps its own defaults, and the list says so.
//
// Also here (so the builder modal and the headless program check share ONE definition):
//   applyDesignToProgram(pg, payload)  restore it in a loaded program window + the steps a rep's typing would run
//   restoreChecks(payload, collected)  what the program did not take as asked (its rule locks, sizes it refused ...)
//
// Plain JS (node-testable).

import { settleDesign, parseCounty, parseZip, activeWraps } from './designSeed.js'
import { DESIGN_SCHEMA, innerDesign, ctxOf, isWebsiteDesign, adaptDesign, storageOf } from './designShape.js'
import { carryFromQuote, notesLeft } from './designCarry.js'

export { DESIGN_SCHEMA }

// ── the page's catalog -> the program's values (CCI) ────────────────────────────────────────────────────────────
const COLOR_HEX = {
  white: '#F2F1EA', galvalume: '#B9BCBB', black: '#1D1E20', 'quaker-gray': '#57534A', 'pewter-gray': '#8A8A88', 'earth-brown': '#74472A',
  evergreen: '#2C5745', 'slate-blue': '#4A7191', 'king-blue': '#2591CE', 'cardinal-red': '#D8291D', 'barn-red': '#A63A20', merlot: '#5C2320',
  burgundy: '#46201F', tan: '#B18F6C', clay: '#A8977E', sandstone: '#D2C4A0', 'pebble-beige': '#DBD1B0',
}
const PRINT_HEX = { 'print-blackwood': '#46443F', 'print-richwood': '#B0A183', 'print-rusticbrick': '#7A6046', 'print-stonewall': '#A8A69E' }
const COLOR_NAME = {
  white: 'White', galvalume: 'Galvalume', black: 'Black', 'quaker-gray': 'Quaker Gray', 'pewter-gray': 'Pewter Gray', 'earth-brown': 'Earth Brown',
  evergreen: 'Evergreen', 'slate-blue': 'Slate Blue', 'king-blue': 'King Blue', 'cardinal-red': 'Cardinal Red', 'barn-red': 'Barn Red', merlot: 'Merlot',
  burgundy: 'Burgundy', tan: 'Tan', clay: 'Clay', sandstone: 'Sandstone', 'pebble-beige': 'Pebble Beige',
  'print-blackwood': 'Black Wood print', 'print-richwood': 'Rich Wood print', 'print-rusticbrick': 'Rustic Brick print', 'print-stonewall': 'Stone Wall print',
}
const ROLLUP_COLOR_KEYS = ['white', 'earthBrown', 'evergreen', 'pewterGray', 'barnRed', 'pebbleBeige', 'black', 'kingBlue', 'cardinalRed', 'burgundy', 'clay', 'tan', 'sandstone', 'slateBlue', 'quakerGray', 'merlot']
const WALK_KEYS = ['std', 'std_blk', '6panel', '6panel_blk', '9lite', '9lite_blk', 'diamond', 'hiwind']
const WINDOW_KEYS = ['std', 'w3036', 'b3030', 'b3036', 'hw', 'hi', 'hi3036']
const WALK_NAME = { std: 'standard white', std_blk: 'standard black', '6panel': '6-panel white', '6panel_blk': '6-panel black', '9lite': '9-lite white', '9lite_blk': '9-lite black', diamond: 'diamond window', hiwind: 'impact-rated (hi-wind)' }
const WINDOW_NAME = { std: 'white 30×30', w3036: 'white 30×36', b3030: 'black 30×30', b3036: 'black 30×36', hw: 'high-wind 30×30', hi: 'impact-rated 30×30', hi3036: 'impact-rated 30×36' }

const END_P = { closed: 'Closed', open: 'Open', gableOnly: 'Gable Only', halfClosed: 'Half Closed' }
const sideP = (v) => (v === 'closed' ? 'Closed' : v === 'open' ? 'Open' : v) // '1panel' .. 'q3' are the program's own values
const LOC = { front: 'Front Gable End', back: 'Back Gable End', left: 'Left Eave Side', right: 'Right Eave Side', partition: 'Partition Wall' }
const ROOF = { Vertical: 'Vertical', 'Boxed Eave': 'Boxed Eve', Regular: 'Regular' } // the program spells it "Boxed Eve"
const INSUL = { none: 'none', roof: 'roof', roofWalls: 'roof-walls' }

// the program's quantity lists: roll-up / walk door 1-4, window / additional component 1-6
const QTY_CAP = { rollup: 4, walk: 4, window: 6, frame: 6 }
const WINDOW_SILL = 50 / 12
const WALK_H = 80 / 12

// framed-opening catalog names (CCI acPrices) - the program prices these; this file never does
const FO = {
  win30: 'Framed Opening — Window 30"x30"',
  winCustom: 'Framed Opening — Window (Custom Size)',
  walk: 'Framed Opening — Walk-Through Door 36"x80"',
  garage: (w) => (w <= 10 ? "Framed Opening — Garage Door (6'-10' Wide)" : `Framed Opening — Garage Door (${w}' Wide)`),
  garageCustom: 'Framed Opening — Custom Garage Door (Custom Size)',
  customFrame: 'Framed Opening — Custom Frame Out (Custom Size)',
}
const GARAGE_BUCKETS = [10, 12, 14, 16] // the widest door each catalog row takes (6'-10', 12', 14', 16')

/**
 * A CCI roll-up size that comes WITH a chain hoist (the program's cciCertHoistIncluded; the design page's hoistIncluded):
 * 14′ / 16′ wide at any height, 12′ wide 12′+ tall, every other width 13′+ tall. The program locks those to "Included"
 * (0 to add), so a customer's hoist tick on one is never an add-on.
 */
export function cciHoistIncluded(w, h) {
  const W = parseInt(w, 10) || 0, H = parseInt(h, 10) || 0
  if (W > 12) return true
  if (W === 12) return H >= 12
  return H >= 13
}

// ── words for the rep ───────────────────────────────────────────────────────────────────────────────────────────
const WALL_NAME = { front: 'front end', back: 'back end', left: 'left side', right: 'right side', partition: 'garage/carport divider wall' }
/** The wall in the rep's words: the partition is the divider on a garage + carport, the storage room's wall otherwise. */
const wallName = (d, w) => (w === 'partition' && d.type !== 'combo' ? 'storage room wall' : WALL_NAME[w])
const LT_SIDE_NAME = { 'Left Eave': 'left side', 'Right Eave': 'right side', 'Front Gable': 'front end', 'Back Gable': 'back end' }
const LT_WALL_NAME = { outer: 'outer wall', front: 'front end', back: 'back end' }
const WRAP_NAME = { FL: 'front-left', FR: 'front-right', BL: 'back-left', BR: 'back-right' }
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
/** 6 -> 6′ ; 6.25 -> 6′3″ (nearest 1/8"). */
export function ftIn(ft) {
  const e = Math.round(Number(ft) * 96) || 0
  const a = Math.abs(e), f = Math.floor(a / 96), r = a - f * 96
  return (e < 0 ? '−' : '') + (r ? `${f}′${Math.floor(r / 8)}${EIGHTHS[r % 8]}″` : `${f}′`)
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) < eps
/** A number the way a rep types it: whole feet as is, else up to 4 decimals (exact on the program's 1/8" grid). */
export function numStr(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(4)))
}
const sizeLabel = (w, h) => `${ftIn(w)} × ${ftIn(h)}`

function partName(o) {
  if (o.kind === 'rollup') return `${sizeLabel(o.w, o.h)} roll-up door`
  if (o.kind === 'walk') return `walk door (${WALK_NAME[o.chosen ?? o.style] || 'standard'})`
  if (o.kind === 'window') return `window (${WINDOW_NAME[o.chosen ?? o.style] || 'white 30×30'})`
  return `${sizeLabel(o.w, o.h)} framed opening (${o.frame === 'window' ? 'window' : 'door'})`
}

const refuse = (reason) => ({ ok: false, reason })
/** The program's building type: GCH, Wide Span (32'+ wide, any walls - the page's own rule), Carport, Standard. */
const btypeOf = (d) => (d.type === 'combo' ? 'gch' : d.width >= 32 ? 'widespan' : d.type === 'carport' ? 'carport' : 'standard')

/**
 * The design inside an envelope; null when it is not one. Reads every shape a design_requests.design comes in: the design
 * link page's envelope, the website's wrapper (designShape.js), or a bare design.
 */
export function designOf(s) {
  return innerDesign(s)
}

/**
 * Why this design_requests.design can't open the builder, or '' when it can (cheap; shown under the buttons).
 */
export function designQuoteReason(envelope) {
  if (isObj(envelope) && envelope.schema !== undefined && envelope.schema !== DESIGN_SCHEMA) return 'This design is not from the customer design page.'
  const raw = designOf(envelope)
  if (!raw) {
    // the website posts the design wrapped with the builder's saved state; when the builder could not read it, the state is null
    if (isObj(envelope) && envelope.source === 'website') return 'The website did not send the 3D building with this one, only the spec text: build it by hand from the spec.'
    return 'This design has no building in it.'
  }
  const d = adaptDesign(raw)
  if (!['garage', 'carport', 'combo'].includes(d.type)) return 'This design has no building type.'
  return ''
}

// ── main openings -> roll-up / walk door / window / framed-opening entries ──────────────────────────────────────────
/**
 * The program values for one framed opening (+ what the rep should know). The design page has only "a framed opening
 * (door / window) of W x H for a customer-supplied unit"; the program has a catalog of frame-out TYPES, each priced its
 * own way. The pick: the catalog frame-out a rep would type for that size (never a typed price), and every door-type
 * one is listed for the rep to confirm. lt = on a lean-to (its entry keeps the W x H; a custom size there is priced
 * from the lean-to frame-out chart by its width, so it is never $0).
 */
function frameChoice(o, { lt = false } = {}) {
  const w = Number(o.w), h = Number(o.h)
  const sz = sizeLabel(w, h)
  const noHeight = near(h, 8) ? '' : `; the catalog frame-out has no height (drawn 8′ tall): note the ${ftIn(h)} height for the order`
  if (o.frame === 'window') {
    if (near(w, 2.5) && near(h, 2.5)) return { act: FO.win30, custom: false, note: '' }
    return { act: FO.winCustom, custom: true, note: `${sz} framed window opening: entered as "Window (Custom Size)" (the program prices a custom window frame-out by its size).` }
  }
  if (near(w, 3) && near(h, 6.67)) return { act: FO.walk, custom: false, note: '' } // the catalog 36"x80" walk-through frame-out
  const exact = GARAGE_BUCKETS.find((b) => near(w, b))
  const garageNote = (b, extra = '') => `${sz} framed door opening: entered as "${FO.garage(b).replace('Framed Opening — ', '')}" (a garage-door frame-out)${extra}${noHeight}. If it is an opening with no door, switch it to "Side Opening, No Door".`
  if (lt) {
    if (exact) return { act: FO.garage(exact), custom: false, note: garageNote(exact) }
    return { act: FO.customFrame, custom: true, note: `${sz} framed door opening: entered as "Custom Frame Out (Custom Size)" (priced from the lean-to frame-out chart by its width). Confirm the frame-out type with the customer.` }
  }
  if (w <= 4 + 1e-9 && h <= 7.5 + 1e-9) {
    return { act: FO.walk, custom: false, note: `${sz} framed door opening: entered as the program's "Walk-Through Door 36″×80″" frame-out (its nearest catalog frame-out). Confirm the size with the customer.` }
  }
  const bucket = GARAGE_BUCKETS.find((b) => w <= b + 1e-9)
  if (bucket) return { act: FO.garage(bucket), custom: false, note: garageNote(bucket, near(w, bucket) ? '' : `; the program draws this catalog frame-out ${ftIn(bucket)} wide (check the spacing on the drawings)`) }
  const side = w <= 18 + 1e-9 ? 18 : w <= 20 + 1e-9 ? 20 : 0
  if (side) {
    return { act: `Framed Opening — Side Opening, No Door (${side}' Wide)`, custom: false,
      note: `${sz} framed door opening: wider than the catalog garage-door frame-outs (16′), entered as "Side Opening, No Door (${side}′ Wide)"${near(w, side) ? '' : `; the program draws it ${side}′ wide`}. If it takes a door, change the frame-out type.` }
  }
  return { act: FO.garageCustom, custom: true, note: `${sz} framed door opening: wider than the catalog frame-outs (20′), entered as "Custom Garage Door (Custom Size)". Check its price in Additional Components (type it if it shows $0).` }
}

/** Consecutive identical openings (same part, wall, size, look) become one program entry with a quantity. */
function groupRuns(list, sigOf, capOf) {
  const out = []
  let cur = null
  for (const o of list) {
    const sig = sigOf(o)
    if (cur && cur.sig === sig && cur.items.length < capOf(o)) { cur.items.push(o); continue }
    cur = { sig, items: [o] }
    out.push(cur)
  }
  return out
}

const pick = (o, keys, dflt) => {
  const v = o.chosen ?? o.style
  return keys.includes(v) ? v : dflt
}

function mainSig(o) {
  const base = `${o.kind}|${o.wall}|${numStr(o.w)}|${numStr(o.h)}`
  if (o.kind === 'rollup') return `${base}|${o.color || 'white'}|${o.hoist === true ? 'h' : ''}|${o.seal === true ? 's' : ''}`
  if (o.kind === 'walk') return `${base}|${pick(o, WALK_KEYS, 'std')}`
  if (o.kind === 'window') return `${base}|${pick(o, WINDOW_KEYS, 'std')}`
  return `${base}|${o.frame}|${numStr(o.sill)}`
}

function mainEntries(d, checks) {
  const out = { doors: [], wtds: [], windows: [], addcomps: [] }
  const u = d.upgrades || {}
  // the program lists entries by part (roll-ups, walk doors, windows, framed openings), each list in the design's order
  for (const kind of ['rollup', 'walk', 'window', 'frame']) {
    const list = d.openings.filter((o) => o.kind === kind)
    for (const g of groupRuns(list, mainSig, () => QTY_CAP[kind])) {
      const o = g.items[0]
      const n = String(g.items.length)
      const positions = g.items.map((x) => ({ val: numStr(x.pos), side: 'left' }))
      const loc = LOC[o.wall]
      if (kind === 'rollup') {
        // chain hoist / brush seal: the page's per-door ticks (10/30/26), a count on the program's entry (every door of a
        // group is the same). A size that comes with a hoist saves 0 (the program shows it Included).
        out.doors.push({
          rloc: loc, rdtype: 'rollup', rsz: `${numStr(o.w)}x${numStr(o.h)}`, rqt: n,
          rch: o.hoist === true && !cciHoistIncluded(o.w, o.h) ? n : '0', rsl: o.seal === true ? n : '0',
          rop: u.openers ? n : '0', r45: u.angle45 ? 'yes' : 'no', rco: ROLLUP_COLOR_KEYS.includes(o.color) ? o.color : 'white', positions,
        })
      } else if (kind === 'walk') {
        out.wtds.push({ wloc: loc, whi: pick(o, WALK_KEYS, 'std'), wqt: n, positions })
      } else if (kind === 'window') {
        out.windows.push({ nloc: loc, ntp: pick(o, WINDOW_KEYS, 'std'), nqt: n, positions })
      } else {
        const c = frameChoice(o)
        const e = { act: c.act, acq: n, 'fo-loc': loc, positions }
        if (c.custom) { e['fo-unit'] = 'ft'; e['fo-cw'] = numStr(o.w); e['fo-ch'] = numStr(o.h) }
        if (o.frame === 'window') e['fo-sill'] = near(o.sill, WINDOW_SILL, 1 / 96) ? '4.17' : numStr(o.sill)
        out.addcomps.push(e)
        if (c.note) checks.push({ level: 'warn', text: `${cap(wallName(d, o.wall))}: ${c.note}${g.items.length > 1 ? ` (${g.items.length} of them)` : ''}` })
      }
    }
  }
  return out
}

// ── lean-tos ───────────────────────────────────────────────────────────────────────────────────────────────────────
const LT_TYPE = { rollup: 'rollup', walk: 'wtd', window: 'win', frame: 'frameout' }
function ltWallLen(d, lt, wall) {
  const host = lt.side === 'Left Eave' || lt.side === 'Right Eave' ? d.length : d.width
  return wall === 'outer' ? Math.min(lt.length, host) : lt.width
}
/** The program's fit-based lean-to quantity list (refreshLTAccQty): floor(wall / (item + 1)), 1..24. */
function ltQtyCap(d, lt, o) {
  const iw = Number(o.w) || 1
  const wl = ltWallLen(d, lt, o.wall)
  return Math.max(1, Math.min(24, Math.floor(wl / (iw + 1))))
}
function ltOpenWalls(lt) {
  if (lt.enclosure === 'enclosed') return ['outer', 'front', 'back']
  if (lt.enclosure !== 'custom') return []
  const out = []
  if (lt.walls.side === 'closed') out.push('outer')
  if (lt.walls.front === 'closed') out.push('front')
  if (lt.walls.back === 'closed') out.push('back')
  return out
}

function leanToEntries(d, checks) {
  const u = d.upgrades || {}
  const out = []
  let ltRollups = 0
  for (const lt of d.leanTos) {
    const name = `${LT_SIDE_NAME[lt.side]} lean-to`
    const e = {
      lts: lt.side, ltw: numStr(lt.width), ltl2: numStr(lt.length), ltoff: numStr(lt.start || 0), lth: numStr(lt.lowLeg), ltp: lt.pitch,
      'lt-type': 'attached', 'lt-wm': lt.enclosure,
    }
    if (lt.enclosure === 'custom') { e['lt-wall-front'] = lt.walls.front; e['lt-wall-back'] = lt.walls.back; e['lt-wall-side'] = lt.walls.side }
    e.accs = []
    const ops = Array.isArray(lt.openings) ? lt.openings : []
    if (lt.enclosure === 'open' && ops.length) {
      // the program hides a lean-to's doors / windows while it has no walls: never a priced part the rep can't see
      checks.push({ level: 'warn', text: `${cap(name)} is open (no walls) on the design, but the customer placed ${ops.length} door${ops.length === 1 ? '' : 's'} / window${ops.length === 1 ? '' : 's'} on it: ${ops.map(partName).join(', ')}. Not entered: close the lean-to's walls and add them if the customer wants them.` })
    } else {
      const walls = ltOpenWalls(lt)
      const off = ops.filter((o) => !walls.includes(o.wall))
      if (off.length) checks.push({ level: 'warn', text: `${cap(name)}: ${off.map((o) => `${partName(o)} on the ${LT_WALL_NAME[o.wall]}`).join(', ')} — that wall is not closed on the design (the page lists it but does not draw it). Entered as drawn: remove it if the customer did not mean it.` })
      const sig = (o) => `${o.kind}|${o.wall}|${numStr(o.w)}|${numStr(o.h)}|${o.kind === 'rollup' ? `${o.color || 'white'}|${o.hoist === true ? 'h' : ''}|${o.seal === true ? 's' : ''}` : o.kind === 'walk' ? pick(o, WALK_KEYS, 'std') : o.kind === 'window' ? pick(o, WINDOW_KEYS, 'std') : `${o.frame}|${numStr(o.sill)}`}`
      for (const g of groupRuns(ops, sig, (o) => ltQtyCap(d, lt, o))) {
        const o = g.items[0]
        const a = { 'lt-acc-type': LT_TYPE[o.kind], 'lt-acc-qty': String(g.items.length), 'lt-acc-loc': o.wall, 'lt-acc-pos': 'offset', offs: g.items.map((x) => numStr(x.pos)) }
        if (o.kind === 'rollup') {
          a['lt-acc-size'] = `${numStr(o.w)}x${numStr(o.h)}`
          a['lt-acc-color'] = ROLLUP_COLOR_KEYS.includes(o.color) ? o.color : 'white'
          a['lt-acc-ch'] = o.hoist === true && !cciHoistIncluded(o.w, o.h) ? String(g.items.length) : '0'
          a['lt-acc-sl'] = o.seal === true ? String(g.items.length) : '0'
          ltRollups += g.items.length
        } else if (o.kind === 'walk') a['lt-acc-wtd-hi'] = pick(o, WALK_KEYS, 'std')
        else if (o.kind === 'window') a['lt-acc-win-hi'] = pick(o, WINDOW_KEYS, 'std')
        else {
          const c = frameChoice(o, { lt: true })
          a['lt-acc-fo-type'] = c.act
          a['lt-acc-fo-w'] = numStr(o.w); a['lt-acc-fo-h'] = numStr(o.h)
          if (o.frame === 'window') a['lt-acc-fo-sill'] = near(o.sill, WINDOW_SILL, 1 / 96) ? '4.17' : numStr(o.sill)
          if (c.note) checks.push({ level: 'warn', text: `${cap(name)}, ${LT_WALL_NAME[o.wall]}: ${c.note}${g.items.length > 1 ? ` (${g.items.length} of them)` : ''}` })
        }
        e.accs.push(a)
      }
    }
    out.push(e)
  }
  if (ltRollups && u.openers) checks.push({ level: 'warn', text: `Roll-up door openers: the program has no opener choice on lean-to roll-up doors — ${ltRollups} lean-to roll-up door${ltRollups === 1 ? '' : 's'} got none. Add them by hand if the customer wants them.` })
  if (ltRollups && u.angle45) checks.push({ level: 'warn', text: `45° angle cut: the program has it on main-building roll-up doors only — ${ltRollups} lean-to roll-up door${ltRollups === 1 ? '' : 's'} need it added by hand.` })
  return out
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1)

/**
 * envelope = design_requests.design ({ schema:'ss-web-design', v, design, ctx }) or a bare design.
 * opts: zip = the ZIP the customer typed on the send form (design_requests.zip); leadZip = the lead's ZIP (fallback);
 *       seedNotes / seedQuoteNumber = what the page could not show from the quote the link started on (design_links.seed_notes).
 *       seedPayload / seedDesign = that quote's payload_json (as saved now) and the design the link opened on
 *       (design_links.seed.design): the new quote KEEPS what the customer could not change (designCarry.js, owner 10/30/26).
 * -> { ok:true, payload, checks:[{level:'warn'|'info', text}], county, zip } | { ok:false, reason }
 */
export function designToQuote(envelope, opts = {}) {
  const why = designQuoteReason(envelope)
  if (why) return refuse(why)
  const inner = designOf(envelope)
  const ctx = ctxOf(envelope)
  const site = isWebsiteDesign(envelope)
  // the website's own fields (12-gauge, end storage room) in the CRM page's model - the SAME object for a design link page design
  const raw = adaptDesign(inner)
  const storage = storageOf(inner)
  const checks = []

  // The page keeps every design inside its own build rules (designSeed.settleDesign = its normalizeDesign): a design the
  // page sent is already settled; one from an older page build is brought inside them the way the page itself would.
  const d = settleDesign(raw, ctx.impact === true, { partition: !!storage })
  // (the website keeps no `chosen` pick on an impact-rated part; settling adds it, which is not a change to the design)
  const same = (x) => (site ? canon(withoutChosen(x)) : canon(x))
  if (same(d) !== same(raw)) checks.push({ level: 'info', text: 'The design was tidied by the design page’s own rules (it was sent by an older page version) — check it against the picture.' })

  const wide = d.width >= 32
  const btype = btypeOf(d)
  const u = d.upgrades || {}
  const f = {
    btype, bw: numStr(d.width), bl: numStr(d.length), bh: numStr(d.height),
    // the program's carport (12'-30') panels are always horizontal (doBld)
    rs: ROOF[d.roofStyle] || 'Vertical', 'pitch-sel': d.pitch, ws: btypeOf(d) === 'carport' ? 'Horizontal' : d.panels,
    // 4' OC is a choice only on 24' and narrower (doBld resets the hidden row to 5oc: wider = 4' OC as standard)
    'framing-upgrade': u.frame12 ? '12' : '14', 'oc-spacing': u.oc4 && d.width <= 24 ? '4oc' : '5oc', 'sheeting-upgrade': u.panels26 ? 'upgrade' : 'standard',
    'insul-sel': INSUL[u.insulation] || 'none', fastenerAdd: u.colorScrews === true,
    cr: COLOR_HEX[d.colors.roof], cw: COLOR_HEX[d.colors.walls], ct: COLOR_HEX[d.colors.trim], wain: d.wainscot ? 'yes' : 'no',
  }
  if (d.wainscot) f.cwn = COLOR_HEX[d.colors.wainscot] || PRINT_HEX[d.colors.wainscot]
  // the website's end storage room = the program's End Storage (Storage / Add'l End Wall): a partition wall `depth` ft in from the
  // front or back end. The program prices it (never here); its depth list is its own frame lines, restoreChecks reads it back.
  if (storage) {
    f['add-end-wall'] = 'yes'
    f['aew-end'] = storage.end
    if (storage.depth) f['aew-depth'] = numStr(storage.depth)
  }

  // walls
  if (btype === 'gch') {
    f.wfg = d.walls.front === 'gableOnly' ? 'Gable Only' : 'Open'
    f.wbg = 'Closed'
    f.wle = sideP(d.walls.left); f.wre = sideP(d.walls.right)
    f['gch-left'] = d.walls.left; f['gch-right'] = d.walls.right // Section 4's eave rows forward to these (cpWallChanged)
    f['gch-enc'] = numStr(d.enclosedLength); f['gch-open'] = numStr(d.length - d.enclosedLength)
  } else if (btype === 'carport') {
    // a carport's sides are ONE control, 4B Side Panels (owner 10/12/26); the hidden Section-4 rows stay Open
    f.wfg = END_P[d.walls.front]; f.wbg = END_P[d.walls.back]; f.wle = 'Open'; f.wre = 'Open'
    f['sp-left'] = d.walls.left; f['sp-right'] = d.walls.right
  } else {
    f.wfg = END_P[d.walls.front]; f.wbg = END_P[d.walls.back]; f.wle = sideP(d.walls.left); f.wre = sideP(d.walls.right)
  }

  // where it goes: the ZIP the customer sent it with, else the page's, else the lead's (the program sets city / county /
  // tax / its county rules from it - applyDesignToProgram)
  const ctxZip = parseZip(ctx.zip)
  const zip = parseZip(opts.zip) || ctxZip || parseZip(opts.leadZip)
  const county = zip && zip === ctxZip ? parseCounty(ctx.county) : !zip ? parseCounty(ctx.county) : null
  f.zip = zip || ''
  if (county) { f.county = county; f._span_county = county; f._span_state = 'FL' } // as collectQuoteData writes them (the span is what restores)
  const leadZip = parseZip(opts.leadZip)
  if (!zip) checks.push({ level: 'warn', text: 'No ZIP on the design or the lead: type the job-site ZIP in Client Information — it sets the county rules (wind, impact windows / doors, permits) and the tax.' })
  else if (leadZip && leadZip !== zip) checks.push({ level: 'info', text: `The customer sent the design with ZIP ${zip}; the lead has ZIP ${leadZip}. The quote uses ${zip} (the job site's county rules and tax) — change it if the building goes elsewhere.` })

  // doors, windows, framed openings
  const off = d.type === 'combo' ? [] : d.openings.filter((o) => o.wall !== 'partition' && d.walls[o.wall] !== 'closed') // (the storage room's wall takes openings)
  if (off.length) checks.push({ level: 'warn', text: `${off.map((o) => `${cap(partName(o))} on the ${wallName(d, o.wall)}`).join('; ')} — that wall is not closed on the design (the page lists it but does not draw it). Entered as drawn: remove it if the customer did not mean it.` })
  const mains = mainEntries(d, checks)
  const leantos = leanToEntries(d, checks)
  const nRoll = mains.doors.reduce((s, e) => s + (parseInt(e.rqt, 10) || 0), 0)
  if (u.openers && nRoll) checks.push({ level: 'info', text: `Roll-up door openers: the design page has one yes/no for all roll-up doors, so all ${nRoll} main-building roll-up door${nRoll === 1 ? '' : 's'} got an opener. Remove any the customer does not want.` })
  if (u.angle45 && nRoll) checks.push({ level: 'info', text: `45° angle cut: the design page has one yes/no for all roll-up doors, so it is on all ${nRoll} main-building roll-up door${nRoll === 1 ? '' : 's'}.` })

  // wrap-around corners: the requested ones (the program decides which hold, like the page)
  const wraps = Array.isArray(d.wraps) ? d.wraps : []
  const drawn = activeWraps(d)
  const lost = wraps.filter((k) => !drawn.includes(k))
  if (lost.length) checks.push({ level: 'warn', text: `Wrap-around corner${lost.length === 1 ? '' : 's'} ${lost.map((k) => WRAP_NAME[k]).join(', ')}: asked for, but the lean-tos there do not qualify (same width, low leg and pitch, running to the corner), so the design did not draw ${lost.length === 1 ? 'it' : 'them'}. Entered as asked: check the program's Wrap-Around Corners note with the customer.` })
  if (btype === 'carport' && d.panels === 'Vertical') {
    checks.push({ level: 'info', text: 'Wall panels: the customer picked vertical; the program’s carport panels are horizontal.' })
    if (d.wainscot && PRINT_HEX[d.colors.wainscot]) checks.push({ level: 'warn', text: `Wainscot: the ${COLOR_NAME[d.colors.wainscot]} needs vertical wall panels, which the program's carport does not have — pick a solid wainscot color with the customer.` })
  }
  if (u.oc4 && d.width > 24) checks.push({ level: 'info', text: 'Trusses 4′ on center (asked for): standard on a building wider than 24′ — nothing to add.' })
  if (wide && d.type === 'carport') checks.push({ level: 'info', text: `A ${ftIn(d.width)}-wide carport is entered as the program's Wide Span building (32′ and wider), with the walls as designed.` })
  if (d.colors.roof === 'galvalume' && d.colors.walls === 'pewter-gray' && d.colors.trim === 'black') checks.push({ level: 'info', text: 'Colors are the design page’s starting colors (Galvalume roof, Pewter Gray walls, Black trim): confirm the customer really picked them.' })

  const seedNotes = Array.isArray(opts.seedNotes) ? opts.seedNotes.filter((n) => typeof n === 'string' && n.trim()) : []
  const seedQ = opts.seedQuoteNumber ? 'quote #' + opts.seedQuoteNumber : 'the quote the link was made from'
  const carryOn = isObj(opts.seedPayload) && isObj(opts.seedPayload.fields)
  if (storage) {
    const where = `${storage.depth ? `${ftIn(storage.depth)} in from` : 'at'} the ${storage.end} end`
    checks.push({ level: 'info', text: `End storage room (asked for on the website): a partition wall ${where}, entered as the program's End Storage (it prices it). Confirm the depth${d.openings.some((o) => o.wall === 'partition') ? ' and the doors / windows on the storage room wall' : ''} with the customer.` })
  }
  if (site) checks.push({ level: 'info', text: 'This design came from the website’s builder, which does not ask about insulation, 26-gauge wall panels, color-match fasteners, roll-up door openers, chain hoists, brush seals or the 45° angle cut: the program’s defaults are used — set them with the customer.' })
  let payload = { version: 3, fields: f, mfr: 'CCI', ovl: 1, doors: mains.doors, wtds: mains.wtds, windows: mains.windows, addcomps: mains.addcomps, leantos }
  if (wraps.length) payload.ltWraps = wraps.join(',')

  // a link started from a quote: the new quote keeps what the customer could not change (designCarry.js)
  let carried = false
  if (carryOn) {
    const c = carryFromQuote(payload, { seedPayload: opts.seedPayload, seedDesign: isObj(opts.seedDesign) ? opts.seedDesign : null, design: d, zipSame: !!zip && parseZip(opts.seedPayload.fields.zip) === zip, seedNotes })
    payload = c.payload
    carried = c.carried
    if (c.kept.length) checks.push({ level: 'info', text: `Kept from ${seedQ} (the customer could not change these on the design page): ${c.kept.join('; ')}.` })
    if (c.notKept.length) checks.push({ level: 'warn', text: `Not kept from ${seedQ} — add again if it still applies: ${c.notKept.join('; ')}.` })
  }
  const leftNotes = carryOn && String(opts.seedPayload.mfr || '').toUpperCase() === 'CCI' ? notesLeft(seedNotes) : seedNotes
  if (leftNotes.length) checks.push({ level: 'warn', text: `This design started from ${seedQ}, which had things the design page cannot show — add them again if they still apply: ${leftNotes.join(' ')}` })
  checks.push(carryOn && String(opts.seedPayload.mfr || '').toUpperCase() === 'CCI'
    ? { level: 'info', text: `Not asked on the design page — kept from ${seedQ} where it had them, the program’s defaults otherwise (check them with the customer): property type / tax exemption, permits / plans, foundation, delivery, lap siding, roof overhang, ${storage ? '' : 'storage partition, '}other additional components. Discounts and typed prices are never copied.` }
    : { level: 'info', text: `Not asked on the design page (the program’s defaults are used — set them with the customer): property type / tax exemption, permits / plans, foundation, delivery, lap siding, roof overhang, ${storage ? '' : 'storage partition, '}other additional components (gutters, cupolas, skylights, trim upgrades), discount.` })
  checks.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1))
  return { ok: true, payload, checks, county, zip: zip || null, carried }
}

/** A copy of a design without the `chosen` pick on its parts (see designToQuote: the website keeps none). */
function withoutChosen(d) {
  try {
    const c = JSON.parse(JSON.stringify(d))
    const strip = (list) => { if (Array.isArray(list)) for (const o of list) if (isObj(o)) delete o.chosen }
    strip(c.openings)
    if (Array.isArray(c.leanTos)) for (const lt of c.leanTos) if (isObj(lt)) strip(lt.openings)
    return c
  } catch { return d }
}

/** Key-order-free JSON (the page and settleDesign build the same objects with their keys in different orders). */
export function canon(v) {
  const sort = (x) => (Array.isArray(x) ? x.map(sort) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, sort(x[k])])) : x)
  try { return JSON.stringify(sort(JSON.parse(JSON.stringify(v)))) } catch { return '' }
}

// ── in the program ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Restore `payload` in a loaded program window (pg = the quote-builder.html window) at TODAY's pricing, then run what a
 * rep's own typing would: the ZIP (doZip -> city, county, tax and the county rule locks; a ZIP the program does not know
 * keeps the county the design named, with its tax via onCountyEdit) and the CCI custom-window frame-out price rule
 * (foAutoCustomWinPrice, which runs when its size is typed - restoreQuoteData sets the size after it).
 * Self-contained (no module references) so the headless program check can run the very same function in the page.
 */
export function applyDesignToProgram(pg, payload) {
  pg.restoreQuoteData(payload)
  const doc = pg.document
  const f = (payload && payload.fields) || {}
  const res = { zip: null, county: null }
  try {
    const z = String(f.zip || '')
    if (/^\d{5}$/.test(z) && pg.ZIP && pg.ZIP[z]) {
      const el = doc.getElementById('zip'); if (el) el.value = z
      pg.doZip(z)
      res.zip = z
    } else if (f._span_county) {
      const c = doc.getElementById('county'); if (c) c.textContent = f._span_county
      if (typeof pg.onCountyEdit === 'function') pg.onCountyEdit()
    }
  } catch (e) { /* the rep types the ZIP */ }
  try {
    doc.querySelectorAll('.ace').forEach((el) => { try { if (typeof pg.foAutoCustomWinPrice === 'function') pg.foAutoCustomWinPrice(el) } catch (e) { /* ignore */ } })
    if (typeof pg.sy === 'function') pg.sy()
    pg.rc()
  } catch (e) { /* priced on the next change */ }
  try { res.county = (doc.getElementById('county') || {}).textContent || null } catch (e) { /* ignore */ }
  return res
}

// ── what the program did not take as asked ───────────────────────────────────────────────────────────────────────
const FIELD_LABEL = {
  btype: 'Building type', bw: 'Width', bl: 'Length', bh: 'Height', rs: 'Roof style', 'pitch-sel': 'Roof pitch', ws: 'Wall panels',
  wfg: 'Front end', wbg: 'Back end', wle: 'Left side', wre: 'Right side', 'sp-left': 'Left side panels', 'sp-right': 'Right side panels',
  'gch-left': 'Left side (carport part)', 'gch-right': 'Right side (carport part)', 'gch-enc': 'Garage (enclosed) length',
  'framing-upgrade': 'Framing gauge', 'oc-spacing': 'Truss spacing', 'sheeting-upgrade': 'Wall panel gauge', 'insul-sel': 'Insulation',
  wain: 'Wainscot', cr: 'Roof color', cw: 'Wall color', ct: 'Trim color', cwn: 'Wainscot color', lap: 'Lap siding', 'delivery-type': 'Delivery',
  'add-end-wall': 'Storage room', 'aew-end': 'Storage room end', 'aew-depth': 'Storage room depth', 'aew-width': 'Storage room width',
  // kept from the quote a link started on (designCarry.js)
  pt: 'Property type', perm: 'Permitting', 'plans-sel': 'Plans', 'permit-svc': 'Permitting service', foundation: 'Foundation', 'overhang-sel': 'Roof overhang',
}
const VALUE_WORDS = {
  'framing-upgrade': { 14: '14-gauge', 12: '12-gauge' }, 'oc-spacing': { '5oc': '5′ on center', '4oc': '4′ on center' },
  'sheeting-upgrade': { standard: 'standard', upgrade: '26-gauge' }, 'insul-sel': { none: 'none', roof: 'roof', 'roof-walls': 'roof + walls' },
  lap: { no: 'no', yes: 'yes' }, wain: { no: 'no', yes: 'yes' }, rs: { 'Boxed Eve': 'Boxed Eave' },
  'add-end-wall': { no: 'none', yes: 'End Storage', left: 'Left Storage', right: 'Right Storage' }, 'aew-end': { front: 'front end', back: 'back end' },
}
// part fields in the rep's words
const KEY_WORDS = {
  rloc: 'wall', rsz: 'size', rqt: 'quantity', rco: 'color', rch: 'chain hoists', rsl: 'brush seals', rop: 'openers', r45: '45° cut', wloc: 'wall', whi: 'type', wqt: 'quantity',
  nloc: 'wall', ntp: 'type', nqt: 'quantity', act: 'type', acq: 'quantity', 'fo-loc': 'wall', 'fo-cw': 'width', 'fo-ch': 'height',
  lts: 'side', ltw: 'width', ltl2: 'length', ltoff: 'starts at', lth: 'low leg', ltp: 'pitch', 'lt-type': 'type', 'lt-wm': 'sides & ends',
  'lt-wall-front': 'front end', 'lt-wall-back': 'back end', 'lt-wall-side': 'side wall',
  'lt-acc-type': 'part', 'lt-acc-size': 'size', 'lt-acc-color': 'color', 'lt-acc-ch': 'chain hoists', 'lt-acc-sl': 'brush seals', 'lt-acc-wtd-hi': 'walk door type', 'lt-acc-win-hi': 'window type', 'lt-acc-qty': 'quantity',
  'lt-acc-loc': 'wall', 'lt-acc-pos': 'position', 'lt-acc-fo-type': 'frame-out type', 'lt-acc-fo-w': 'width', 'lt-acc-fo-h': 'height',
}
const kw = (k) => KEY_WORDS[k] || k
const HEX_NAME = Object.fromEntries(Object.entries({ ...COLOR_HEX, ...PRINT_HEX }).map(([k, h]) => [h, COLOR_NAME[k]]))
const words = (k, v) => {
  const s = String(v ?? '')
  if (s === '') return '(blank)'
  if (/^c(r|w|t|wn)$/.test(k)) return HEX_NAME[s.toUpperCase()] || s
  return (VALUE_WORDS[k] && VALUE_WORDS[k][s]) || s
}
const sameVal = (a, b) => {
  const x = String(a ?? ''), y = String(b ?? '')
  if (x === y) return true
  const nx = Number(x), ny = Number(y)
  return x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) && Math.abs(nx - ny) < 1e-6
}
const sameHex = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase()

/**
 * The program's own reasons for a value it set differently from what the design asked (rule locks). `T` = the program's
 * window._qTotals after the restore (free 26-gauge / fasteners). Returns { level, text }.
 */
function why(k, want, got, T, county) {
  const co = county ? ` in ${county} County` : ''
  if (k === 'framing-upgrade' && String(got) === '12') return { level: 'warn', text: `Framing: the program requires 12-gauge framing here${co} (county / size / use rule) — the customer did not ask for it. It is priced.` }
  if (k === 'oc-spacing' && got === '4oc') return { level: 'warn', text: `Truss spacing: the program requires 4′ on center here${co} (county / wind rule) — the customer did not ask for it. It is priced.` }
  if (k === 'lap' && got === 'yes') return { level: 'warn', text: `Lap siding: the program adds it here${co} (county rule) — the design page does not ask about it. Override it in the program if the site is outside the rule.` }
  if (k === 'aew-depth') return { level: 'warn', text: `Storage room: the program offers the partition on its truss lines, so it set ${got}′ (the nearest to the ${want}′ the customer drew). Check it with the customer.` }
  if (k === 'gch-enc') return { level: 'warn', text: `Garage (enclosed) part: the program offers the garage / carport split on its truss lines and 5′ steps, so it set ${got}′ (the nearest to the ${want}′ the customer drew). Check it with the customer.` }
  if (k === 'delivery-type') return { level: 'warn', text: `Delivery: the program set "${got}"${co} (no installation service there).` }
  if (k === 'sheeting-upgrade' && got === 'upgrade' && T && T.sheetFree) return { level: 'info', text: '26-gauge wall panels: included free by the program (order over its free-upgrade amount).' }
  if (k === 'rs') return { level: 'info', text: `Roof style: the program uses ${words(k, got)} on this building (the design asked ${words(k, want)}).` }
  if (k === 'ws') return { level: 'info', text: `Wall panels: the program uses ${got} panels on this building (the design asked ${want}).` }
  return null
}

/**
 * Compare what was handed to the program (payload) with what it holds after the restore (collected = its own
 * collectQuoteData()). Every difference is one line for the rep. T = window._qTotals (optional), county = the program's.
 */
export function restoreChecks(payload, collected, { T = null, county = null } = {}) {
  const out = []
  const f = (payload && payload.fields) || {}
  const g = (collected && collected.fields) || {}
  if (!collected || !isObj(g)) return [{ level: 'warn', text: 'Could not read the quote program back after filling it in: check every part of the build against the design.' }]
  if (collected.mfr && payload.mfr && collected.mfr !== payload.mfr) out.push({ level: 'warn', text: `Manufacturer: the program is on ${collected.mfr}, the design was entered for CCI.` })
  for (const k of Object.keys(FIELD_LABEL)) {
    if (k === 'lap' || k === 'delivery-type') continue
    if (!(k in f)) continue
    const want = f[k], got = g[k]
    if (/^c(r|w|t|wn)$/.test(k) ? sameHex(want, got) : sameVal(want, got)) continue
    const r = why(k, want, got, T, county)
    const fromQuote = ['pt', 'perm', 'plans-sel', 'permit-svc', 'foundation', 'overhang-sel'].includes(k)
    out.push(r || { level: 'warn', text: fromQuote ? `${FIELD_LABEL[k]}: kept from the quote as ${words(k, want)}, the program shows ${words(k, got)} (its rules here). Check it.` : `${FIELD_LABEL[k]}: the design asks ${words(k, want)}, the program shows ${words(k, got)} — it could not take that value here. Check it.` })
  }
  // rule-driven fields the design never sets: the program's defaults are lap 'no', delivery 'installed'
  // (lap siding / delivery kept from a seed quote are the quote's own, not a county rule: only a change from what was handed in)
  if (g.lap === 'yes' && f.lap !== 'yes') out.push(why('lap', 'no', 'yes', T, county))
  if (f.lap === 'yes' && g.lap !== 'yes') out.push({ level: 'warn', text: 'Lap siding: kept from the quote, but the program does not show it on this building. Check it.' })
  if (g['delivery-type'] && g['delivery-type'] !== (f['delivery-type'] || 'installed')) out.push(why('delivery-type', f['delivery-type'] || 'installed', g['delivery-type'], T, county))
  if (f.fastenerAdd === true && g.fastenerAdd !== true) {
    out.push(T && T.fastenerFree ? { level: 'info', text: 'Color-match fasteners: included free by the program (order over its free-upgrade amount).' } : { level: 'warn', text: 'Color-match fasteners: the design asks for them, the program does not show them ticked. Check it.' })
  }
  // parts (impact-rated swaps by the program's county lock are gathered into one line)
  const impact = { 'walk door': [], window: [] }
  const list = (k) => (Array.isArray(payload[k]) ? payload[k] : [])
  const got = (k) => (Array.isArray(collected[k]) ? collected[k] : [])
  const cmpList = (k, keys, label, impKey) => {
    const a = list(k), b = got(k)
    if (a.length !== b.length) out.push({ level: 'warn', text: `${label(a[0] || b[0] || {})}: the design has ${a.length} entr${a.length === 1 ? 'y' : 'ies'}, the program holds ${b.length}. Check them.` })
    a.forEach((e, i) => {
      const h = b[i]
      if (!h) return
      for (const key of keys) {
        if (!(key in e) || sameVal(e[key], h[key])) continue
        if (key === impKey && /^(hiwind|hi|hi3036)$/.test(String(h[key]))) {
          impact[impKey === 'whi' ? 'walk door' : 'window'].push(`${impKey === 'whi' ? WALK_NAME[e[key]] || e[key] : WINDOW_NAME[e[key]] || e[key]}${Number(e[impKey === 'whi' ? 'wqt' : 'nqt']) > 1 ? ` ×${e[impKey === 'whi' ? 'wqt' : 'nqt']}` : ''} (${String(e[impKey === 'whi' ? 'wloc' : 'nloc']).replace(/ (Gable End|Eave Side)$/, '').toLowerCase()})`)
          continue
        }
        out.push({ level: 'warn', text: `${label(e)}: ${kw(key)} — the design asks "${e[key]}", the program shows "${h[key] ?? ''}" (it could not take that value here). Check it.` })
      }
      const pa = Array.isArray(e.positions) ? e.positions : [], pb = Array.isArray(h.positions) ? h.positions : []
      pa.forEach((p, j) => {
        const q = pb[j]
        if (!q || !sameVal(p.val, q.val) || (q.side || 'left') !== (p.side || 'left')) out.push({ level: 'warn', text: `${label(e)}: position ${j + 1} did not take (${numStr(p.val)} ft asked). Check it.` })
      })
    })
  }
  cmpList('doors', ['rloc', 'rsz', 'rqt', 'rco', 'rch', 'rsl', 'rop', 'r45'], (e) => `Roll-up door ${e.rsz || ''} (${e.rloc || ''})`)
  cmpList('wtds', ['wloc', 'whi', 'wqt'], (e) => `Walk door (${e.wloc || ''})`, 'whi')
  cmpList('windows', ['nloc', 'ntp', 'nqt'], (e) => `Window (${e.nloc || ''})`, 'ntp')
  cmpList('addcomps', ['act', 'acq', 'fo-loc', 'fo-cw', 'fo-ch'], (e) => `${String(e.act || 'Framed opening').replace('Framed Opening — ', 'Framed opening ')} (${e['fo-loc'] || ''})`)
  const la = list('leantos'), lb = got('leantos')
  if (la.length !== lb.length) out.push({ level: 'warn', text: `Lean-tos: the design has ${la.length}, the program holds ${lb.length}. Check them.` })
  la.forEach((e, i) => {
    const h = lb[i]
    if (!h) return
    const nm = `${cap(LT_SIDE_NAME[e.lts] || 'the')} lean-to`
    for (const key of ['lts', 'ltw', 'ltl2', 'ltoff', 'lth', 'ltp', 'lt-type', 'lt-wm', 'lt-wall-front', 'lt-wall-back', 'lt-wall-side']) {
      if (!(key in e) || sameVal(e[key], h[key])) continue
      out.push({ level: 'warn', text: `${nm}: ${kw(key)} — the design asks "${e[key]}", the program shows "${h[key] ?? ''}". Check it.` })
    }
    const aa = Array.isArray(e.accs) ? e.accs : [], ab = Array.isArray(h.accs) ? h.accs : []
    if (aa.length !== ab.length) out.push({ level: 'warn', text: `${nm}: the design has ${aa.length} door / window entr${aa.length === 1 ? 'y' : 'ies'}, the program holds ${ab.length}. Check them.` })
    aa.forEach((a, j) => {
      const b = ab[j]
      if (!b) return
      for (const key of ['lt-acc-type', 'lt-acc-size', 'lt-acc-color', 'lt-acc-ch', 'lt-acc-sl', 'lt-acc-wtd-hi', 'lt-acc-win-hi', 'lt-acc-qty', 'lt-acc-loc', 'lt-acc-pos', 'lt-acc-fo-type', 'lt-acc-fo-w', 'lt-acc-fo-h']) {
        if (!(key in a) || sameVal(a[key], b[key])) continue
        if ((key === 'lt-acc-wtd-hi' || key === 'lt-acc-win-hi') && /^(hiwind|hi|hi3036)$/.test(String(b[key]))) {
          const wd = key === 'lt-acc-wtd-hi'
          impact[wd ? 'walk door' : 'window'].push(`${wd ? WALK_NAME[a[key]] || a[key] : WINDOW_NAME[a[key]] || a[key]}${Number(a['lt-acc-qty']) > 1 ? ` ×${a['lt-acc-qty']}` : ''} (${LT_SIDE_NAME[e.lts] || ''} lean-to)`)
          continue
        }
        out.push({ level: 'warn', text: `${nm}, ${LT_WALL_NAME[a['lt-acc-loc']] || 'wall'} ${a['lt-acc-type'] === 'wtd' ? 'walk door' : a['lt-acc-type'] === 'win' ? 'window' : a['lt-acc-type'] === 'frameout' ? 'framed opening' : 'roll-up door'}: ${kw(key)} — the design asks "${a[key]}", the program shows "${b[key] ?? ''}" (it could not take that value here). Check it.` })
      }
      const oa = Array.isArray(a.offs) ? a.offs : [], ob = Array.isArray(b.offs) ? b.offs : []
      if (oa.some((v, k) => !sameVal(v, ob[k]))) out.push({ level: 'warn', text: `${nm}: the ${a['lt-acc-type']} offsets did not all take (${oa.join(', ')} ft asked). Check them.` })
    })
  })
  const imp = Object.entries(impact).filter(([, v]) => v.length)
  if (imp.length) out.push({ level: 'info', text: `Impact-rated by the program's county rule${county ? ` (${county} County)` : ''}: ${imp.map(([k, v]) => `${k}s entered impact-rated — the customer picked ${v.join(', ')}`).join('; ')}.` })
  const wantW = String(payload.ltWraps || ''), gotW = String(collected.ltWraps || '')
  if (wantW !== gotW) out.push({ level: 'warn', text: `Wrap-around corners: the design asks "${wantW || 'none'}", the program holds "${gotW || 'none'}". Check them.` })
  // one line per message
  const seen = new Set()
  return out.filter((c) => c && !seen.has(c.text) && seen.add(c.text))
}

/** Design checks + program checks, warnings first, no repeats. */
export function mergeChecks(...lists) {
  const seen = new Set()
  const all = lists.flat().filter((c) => c && c.text && !seen.has(c.text) && seen.add(c.text))
  return [...all.filter((c) => c.level === 'warn'), ...all.filter((c) => c.level !== 'warn')]
}
