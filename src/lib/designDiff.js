// designDiff: what a customer changed on the building their rep sent them (owner 10/20/26: "I'd get the
// adjustment from them & rework their quote"). Pure: designDiff(seedState, sentState) -> [{ kind, text }].
//
// Both arguments are the design page's saved-design envelope { schema:'ss-web-design', v:1, design } (or a bare
// design). The seed is stored already settled by the page's own rules (designSeed.js), and the page sends its
// design settled the same way, so what differs is what the customer did. Feet compare on the 1/8" grid; an
// impact-rated walk door / window compares by the customer's own pick (`chosen`), so a ZIP that turns the
// impact rule on or off is not a "change".
//
// The label maps below are copied from the page (web-customer/src/model/design.ts, catalog.ts): the CRM cannot
// import the page's TypeScript. Plain JS, no imports (node-testable).

const EPS = 1 / 96 - 1e-9 // one 1/8" step: anything closer is the same number

const TYPE_LABEL = { garage: 'Garage', carport: 'Carport', combo: 'Garage + Carport' }
const WALL_LABEL = { front: 'front end', back: 'back end', left: 'left side', right: 'right side', partition: 'garage/carport divider wall' }
const MAIN_WALL_TITLE = { front: 'Front end wall', back: 'Back end wall', left: 'Left side wall', right: 'Right side wall' }
const LEANTO_SIDE_LABEL = { 'Left Eave': 'left side', 'Right Eave': 'right side', 'Front Gable': 'front end', 'Back Gable': 'back end' }
const LEANTO_WALL_LABEL = { outer: 'outer wall', front: 'front end', back: 'back end' }
const END_WALL_LABEL = { closed: 'Closed', open: 'Open', gableOnly: 'Gable only (top triangle)', halfClosed: 'Half closed (6′ panel from the top)' }
const SIDE_WALL_LABEL = {
  closed: 'Closed', open: 'Open', '1panel': '1 panel from the top (3′)', '2panel': '2 panels from the top (6′)', '3panel': '3 panels from the top (9′)',
  q1: '¼ closed from the top', q2: '½ closed from the top', q3: '¾ closed from the top',
}
const LEANTO_END_LABEL = {
  open: 'Open', closed: 'Closed', gable: 'Gable only (top triangle)', halfEnd: 'Half end (tall half)', q1: '¼ closed from the top', q2: '½ closed from the top', q3: '¾ closed from the top',
}
const WRAP_LABEL = { FL: 'front-left corner', FR: 'front-right corner', BL: 'back-left corner', BR: 'back-right corner' }
const ENCLOSURE_LABEL = { open: 'Open', enclosed: 'Fully enclosed', custom: 'Custom walls' }
const COLOR_NAME = {
  white: 'White', galvalume: 'Galvalume', black: 'Black', 'quaker-gray': 'Quaker Gray', 'pewter-gray': 'Pewter Gray', 'earth-brown': 'Earth Brown', evergreen: 'Evergreen',
  'slate-blue': 'Slate Blue', 'king-blue': 'King Blue', 'cardinal-red': 'Cardinal Red', 'barn-red': 'Barn Red', merlot: 'Merlot', burgundy: 'Burgundy', tan: 'Tan', clay: 'Clay',
  sandstone: 'Sandstone', 'pebble-beige': 'Pebble Beige', 'print-blackwood': 'Black Wood print', 'print-richwood': 'Rich Wood print', 'print-rusticbrick': 'Rustic Brick print',
  'print-stonewall': 'Stone Wall print',
}
const ROLLUP_COLOR_NAME = {
  white: 'White', earthBrown: 'Earth Brown', evergreen: 'Evergreen', pewterGray: 'Pewter Gray', barnRed: 'Barn Red', pebbleBeige: 'Pebble Beige', black: 'Black', kingBlue: 'King Blue',
  cardinalRed: 'Cardinal Red', burgundy: 'True Burgundy', clay: 'Clay', tan: 'Tan', sandstone: 'Sandstone', slateBlue: 'Slate Blue', quakerGray: 'Quaker Gray', merlot: 'Vintage Burgundy',
}
const WALK_NAME = {
  std: 'Standard, white', std_blk: 'Standard, black', '6panel': '6-panel, white', '6panel_blk': '6-panel, black', '9lite': '9-lite (glass), white', '9lite_blk': '9-lite (glass), black',
  diamond: 'Diamond window, white', hiwind: 'Impact-rated (hi-wind), white',
}
const WINDOW_NAME = {
  std: 'White 30×30', w3036: 'White 30×36', b3030: 'Black 30×30', b3036: 'Black 30×36', hw: 'High-wind rated 30×30', hi: 'Impact-rated 30×30', hi3036: 'Impact-rated 30×36',
}
const UPGRADE_LABEL = {
  insulation: 'Insulation', frame12: '12-gauge framing', oc4: 'Trusses 4′ on center', panels26: '26-gauge wall panels', colorScrews: 'Color-match fasteners', angle45: '45° angle cut on roll-up doors', openers: 'Roll-up door openers',
}
const INSULATION_LABEL = { none: 'none', roof: 'roof', roofWalls: 'roof and walls' }

const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
/** 6.0 -> 6′ ; 6.25 -> 6′3″ (nearest 1/8"). */
export function fmtFt(ft) {
  const e = Math.round(Number(ft) * 96) || 0
  const a = Math.abs(e), f = Math.floor(a / 96), r = a - f * 96
  return (e < 0 ? '−' : '') + (r ? `${f}′${Math.floor(r / 8)}${EIGHTHS[r % 8]}″` : `${f}′`)
}
const dim = (n) => { const v = Math.round(Number(n) * 10) / 10; return String(v % 1 === 0 ? v : v.toFixed(1)) }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < EPS
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1)

/** The design inside an envelope (or the bare design); null when it is not one. */
function designOf(s) {
  const d = isObj(s) && isObj(s.design) ? s.design : s
  return isObj(d) && typeof d.type === 'string' && isObj(d.walls) ? d : null
}

/** The part's look for a person: "10×10 roll-up door", "3×7 walk door", "30×36 window", "10×8 framed opening". */
function partName(o) {
  if (o.kind === 'rollup') return `${dim(o.w)}×${dim(o.h)} roll-up door`
  if (o.kind === 'walk') return `${dim(o.w)}×${Math.round(o.h)} walk door`
  if (o.kind === 'window') return `${Math.round(o.w * 12)}×${Math.round(o.h * 12)} window`
  return o.frame === 'window' ? `${dim(o.w)}×${dim(o.h)} framed window opening` : `${dim(o.w)}×${dim(o.h)} framed opening`
}
/** What the customer picked for the look (impact-rated parts compare by the pick they stand in for). */
const lookOf = (o) => (o.kind === 'walk' || o.kind === 'window' ? (o.chosen ?? o.style ?? '') : o.kind === 'rollup' ? (o.color ?? 'white') : (o.frame ?? 'door'))
function lookName(o) {
  const k = lookOf(o)
  if (o.kind === 'walk') return WALK_NAME[k] || String(k)
  if (o.kind === 'window') return WINDOW_NAME[k] || String(k)
  if (o.kind === 'rollup') return ROLLUP_COLOR_NAME[k] || String(k)
  return String(k)
}
const sizeSame = (a, b) => near(a.w, b.w) && near(a.h, b.h)

/**
 * Pair the seed's openings with the sent ones: same id (and same kind) first, then the same kind on the same
 * wall at the same spot, then leftovers of the same kind, wall and size (a part the customer dragged).
 */
function pairOpenings(a, b, wallOf = (o) => o.wall) {
  const pairs = []
  const ra = a.slice(), rb = b.slice()
  const take = (match) => {
    for (let i = 0; i < ra.length; i++) {
      const j = rb.findIndex((y) => match(ra[i], y))
      if (j >= 0) { pairs.push([ra[i], rb[j]]); ra.splice(i, 1); rb.splice(j, 1); i-- }
    }
  }
  take((x, y) => x.id && x.id === y.id && x.kind === y.kind)
  take((x, y) => x.kind === y.kind && wallOf(x) === wallOf(y) && near(x.pos, y.pos))
  take((x, y) => x.kind === y.kind && wallOf(x) === wallOf(y) && sizeSame(x, y) && lookOf(x) === lookOf(y))
  return { pairs, removed: ra, added: rb }
}

function diffOpenings(a, b, push, wallName) {
  const { pairs, removed, added } = pairOpenings(a || [], b || [])
  for (const o of removed) push('opening', `Removed: ${partName(o)}, ${wallName(o)}`)
  for (const o of added) push('opening', `Added: ${partName(o)}, ${wallName(o)}`)
  for (const [x, y] of pairs) {
    const name = partName(y)
    if (x.wall !== y.wall) push('opening', `Moved: ${name} ${wallName(x)} → ${wallName(y)}`)
    else if (!near(x.pos, y.pos)) push('opening', `Moved: ${name}, ${wallName(y)}: ${fmtFt(x.pos)} → ${fmtFt(y.pos)}`)
    if (!sizeSame(x, y)) push('opening', `Changed: ${wallName(y)} ${lower(kindWord(y))} size ${dim(x.w)}×${dim(x.h)} → ${dim(y.w)}×${dim(y.h)}`)
    if (lookOf(x) !== lookOf(y)) push('opening', y.kind === 'rollup' ? `Roll-up door color (${wallName(y)}): ${lookName(x)} → ${lookName(y)}` : `Changed: ${wallName(y)} ${lower(kindWord(y))}: ${lookName(x)} → ${lookName(y)}`)
    if (x.kind === 'frame' && x.frame !== y.frame) push('opening', `Changed: ${wallName(y)} framed opening: ${x.frame} type → ${y.frame} type`)
  }
}
const kindWord = (o) => ({ rollup: 'roll-up door', walk: 'walk door', window: 'window', frame: 'framed opening' })[o.kind] || 'opening'

/**
 * What changed from the seed (the building the rep sent) to the sent design. [] when nothing changed.
 * Each line: { kind: 'size'|'style'|'walls'|'color'|'opening'|'leanto'|'upgrade', text }.
 */
export function designDiff(seedState, sentState) {
  const a = designOf(seedState), b = designOf(sentState)
  if (!a || !b) return []
  const out = []
  const push = (kind, text) => out.push({ kind, text })

  // size and type
  if (a.type !== b.type) push('size', `Type: ${TYPE_LABEL[a.type] || a.type} → ${TYPE_LABEL[b.type] || b.type}`)
  if (!near(a.width, b.width)) push('size', `Width ${fmtFt(a.width)} → ${fmtFt(b.width)}`)
  if (!near(a.length, b.length)) push('size', `Length ${fmtFt(a.length)} → ${fmtFt(b.length)}`)
  if (!near(a.height, b.height)) push('size', `Height ${fmtFt(a.height)} → ${fmtFt(b.height)}`)
  if ((a.type === 'combo' || b.type === 'combo') && !near(a.enclosedLength, b.enclosedLength)) push('size', `Garage part length ${fmtFt(a.enclosedLength)} → ${fmtFt(b.enclosedLength)}`)
  if (a.roofStyle !== b.roofStyle) push('style', `Roof style: ${a.roofStyle} → ${b.roofStyle}`)
  if (a.pitch !== b.pitch) push('style', `Roof pitch: ${a.pitch} → ${b.pitch}`)
  if (a.panels !== b.panels) push('style', `Wall panels: ${a.panels} → ${b.panels}`)

  // walls
  for (const w of ['front', 'back']) {
    if (a.walls[w] !== b.walls[w]) push('walls', `${MAIN_WALL_TITLE[w]}: ${END_WALL_LABEL[a.walls[w]] || a.walls[w]} → ${END_WALL_LABEL[b.walls[w]] || b.walls[w]}`)
  }
  for (const w of ['left', 'right']) {
    if (a.walls[w] !== b.walls[w]) push('walls', `${MAIN_WALL_TITLE[w]}: ${SIDE_WALL_LABEL[a.walls[w]] || a.walls[w]} → ${SIDE_WALL_LABEL[b.walls[w]] || b.walls[w]}`)
  }

  // colors
  const ca = a.colors || {}, cb = b.colors || {}
  const col = (k) => COLOR_NAME[k] || String(k)
  if (ca.roof !== cb.roof) push('color', `Roof color: ${col(ca.roof)} → ${col(cb.roof)}`)
  if (ca.walls !== cb.walls) push('color', `Wall color: ${col(ca.walls)} → ${col(cb.walls)}`)
  if (ca.trim !== cb.trim) push('color', `Trim color: ${col(ca.trim)} → ${col(cb.trim)}`)
  if (!!a.wainscot !== !!b.wainscot) push('color', `Wainscot: ${a.wainscot ? 'on' : 'off'} → ${b.wainscot ? 'on' : 'off'}`)
  else if (a.wainscot && b.wainscot && ca.wainscot !== cb.wainscot) push('color', `Wainscot color: ${col(ca.wainscot)} → ${col(cb.wainscot)}`)

  // doors and windows on the building
  diffOpenings(a.openings, b.openings, push, (o) => WALL_LABEL[o.wall] || o.wall)

  // lean-tos
  const lts = (d) => (Array.isArray(d.leanTos) ? d.leanTos : [])
  const ltName = (l) => LEANTO_SIDE_LABEL[l.side] || l.side
  for (const x of lts(a)) {
    const y = lts(b).find((l) => l.side === x.side)
    if (!y) { push('leanto', `Lean-to removed: ${ltName(x)} ${dim(x.width)}′ × ${dim(x.length)}′`); continue }
    const nm = `${ltName(x)} lean-to`
    if (!near(x.width, y.width)) push('leanto', `${cap(nm)} width ${fmtFt(x.width)} → ${fmtFt(y.width)}`)
    if (!near(x.length, y.length)) push('leanto', `${cap(nm)} length ${fmtFt(x.length)} → ${fmtFt(y.length)}`)
    if (!near(x.start, y.start)) push('leanto', `${cap(nm)} starts at ${fmtFt(x.start)} → ${fmtFt(y.start)}`)
    if (!near(x.lowLeg, y.lowLeg)) push('leanto', `${cap(nm)} low leg ${fmtFt(x.lowLeg)} → ${fmtFt(y.lowLeg)}`)
    if (x.pitch !== y.pitch) push('leanto', `${cap(nm)} pitch ${x.pitch} → ${y.pitch}`)
    if (x.enclosure !== y.enclosure) push('leanto', `${cap(nm)} walls: ${ENCLOSURE_LABEL[x.enclosure] || x.enclosure} → ${ENCLOSURE_LABEL[y.enclosure] || y.enclosure}`)
    const wx = x.walls || {}, wy = y.walls || {}
    for (const k of ['front', 'back']) if (wx[k] !== wy[k]) push('leanto', `${cap(nm)} ${LEANTO_WALL_LABEL[k]}: ${LEANTO_END_LABEL[wx[k]] || wx[k]} → ${LEANTO_END_LABEL[wy[k]] || wy[k]}`)
    if (wx.side !== wy.side) push('leanto', `${cap(nm)} outer wall: ${SIDE_WALL_LABEL[wx.side] || wx.side} → ${SIDE_WALL_LABEL[wy.side] || wy.side}`)
    diffOpenings(x.openings, y.openings, push, (o) => `${nm} ${LEANTO_WALL_LABEL[o.wall] || o.wall}`)
  }
  for (const y of lts(b)) {
    if (!lts(a).some((x) => x.side === y.side)) push('leanto', `Lean-to added: ${ltName(y)} ${dim(y.width)}′ × ${dim(y.length)}′`)
  }
  const wa = Array.isArray(a.wraps) ? a.wraps : [], wb = Array.isArray(b.wraps) ? b.wraps : []
  for (const k of wb) if (!wa.includes(k)) push('leanto', `Wrap-around added: ${WRAP_LABEL[k] || k}`)
  for (const k of wa) if (!wb.includes(k)) push('leanto', `Wrap-around removed: ${WRAP_LABEL[k] || k}`)

  // upgrades
  const ua = a.upgrades || {}, ub = b.upgrades || {}
  for (const k of ['insulation', 'frame12', 'oc4', 'panels26', 'colorScrews', 'openers', 'angle45']) {
    if (k === 'insulation') {
      const x = ua.insulation || 'none', y = ub.insulation || 'none'
      if (x !== y) push('upgrade', `Insulation: ${INSULATION_LABEL[x] || x} → ${INSULATION_LABEL[y] || y}`)
    } else if (!!ua[k] !== !!ub[k]) push('upgrade', `Upgrade ${ub[k] ? 'added' : 'removed'}: ${UPGRADE_LABEL[k]}`)
  }
  return out
}

function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1) }

/** One line for the summary: "3 changes from quote #X" / "No changes from quote #X". */
export function diffSummary(changes, quoteNumber) {
  const n = Array.isArray(changes) ? changes.length : 0
  const q = quoteNumber ? ` from quote #${quoteNumber}` : ' from the building you sent'
  return n ? `${n} change${n === 1 ? '' : 's'}${q}` : `No changes${q}`
}
