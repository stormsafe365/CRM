// designShape: the ONE place that knows how a design_requests.design is wrapped (owner 10/24/26: "Build quote from this
// design" was disabled, and the card title read just "Customer design", on designs that came from the WEBSITE).
//
// Two senders put a design into design_requests.design, and they wrap it differently:
//
//   design link page (3D Builder configurator/web-customer, src/send.ts `design: p.state`): the saved-state envelope itself
//       { schema:'ss-web-design', v:1, design:{ ...the real design... }, ctx:{ zip, county, impact } }
//
//   the website's Customize page (stormsafe-site public/customize.html, sendToCrm), wrapped one level deeper
//       { schema:'ss-web-design', source:'website', type, width, length, height,
//         state:{ schema:'ss-web-design', v:1, design:{ ...the real design... }, ctx:{ zip, county, impact } } }
//
// (and a bare design, which the tests and older callers pass). Everything in the CRM that reads a design goes through
// innerDesign() / ctxOf(), so both shapes work everywhere and a new wrapper is added in one place.
//
// The website's builder is a fork of the same model (types garage / carport / combo, schema 'ss-web-design') with a few
// fields of its own; adaptDesign() / storageOf() bring those into the shape the CRM page's model has (see below).
//
// Plain JS, no imports (node-testable).

export const DESIGN_SCHEMA = 'ss-web-design'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
/** A real design: a building type and its walls. (The website's outer wrapper has a type too, but no walls.) */
const isDesign = (d) => isObj(d) && typeof d.type === 'string' && isObj(d.walls)

/**
 * Find the real design. -> { design, envelope, via } | null
 *   via: 'link' (design link page), 'website' (the website's Customize page), 'bare' (a design on its own)
 *   envelope: the object that holds the design's `ctx` (the saved-state envelope).
 */
export function unwrapDesign(s) {
  if (!isObj(s)) return null
  const site = s.source === 'website'
  if (isDesign(s.design)) return { design: s.design, envelope: s, via: site ? 'website' : 'link' }
  const st = s.state
  if (isObj(st)) {
    if (isDesign(st.design)) return { design: st.design, envelope: st, via: 'website' }
    if (isDesign(st)) return { design: st, envelope: s, via: 'website' }
  }
  if (isDesign(s)) return { design: s, envelope: s, via: site ? 'website' : 'bare' }
  return null
}

/** The real design (type, width, length, height, walls, openings, leanTos ...) from any shape; null when there is none. */
export function innerDesign(s) {
  const u = unwrapDesign(s)
  return u ? u.design : null
}

/**
 * The design for a one-line summary: like innerDesign, but any object under `design` (or the website's `state.design`) counts,
 * walls or not - the summary only needs the type and the size. A bare design is not looked for here (it never was).
 */
export function summaryDesign(s) {
  if (!isObj(s)) return null
  if (isObj(s.design)) return s.design
  return isObj(s.state) && isObj(s.state.design) ? s.state.design : null
}

/** Where the design was drawn: { zip, county, impact } (empty object when the sender did not say). */
export function ctxOf(s) {
  const u = unwrapDesign(s)
  for (const e of [u && u.envelope, s, isObj(s) ? s.state : null]) if (isObj(e) && isObj(e.ctx)) return e.ctx
  return {}
}

/** True for a row the website's Customize page sent (it has no design-link seed: nothing to compare it with). */
export function isWebsiteDesign(s) {
  if (!isObj(s)) return false
  if (s.source === 'website') return true
  const u = unwrapDesign(s)
  return !!u && u.via === 'website'
}

// ── the website's own fields ────────────────────────────────────────────────────────────────────────────────────
// The website's builder (stormsafe-site builder-src/web-customer/src/model/design.ts) is an earlier fork of the design page.
// What it does differently from the CRM page's model:
//   upgrades  { gauge12, oc4, vertical }   (the page: { insulation, frame12, oc4, panels26, colorScrews, openers, angle45 })
//             gauge12 is the page's frame12 (12-gauge framing). `vertical` is the wall-panel pick, which `panels` already holds.
//             The website never asks insulation, 26-gauge panels, color-match fasteners, openers or the 45 cut.
//   storage   { on, end:'front'|'back', depth }   an END storage room walled off by a partition (the page has none); doors and
//             windows may go on its wall (wall 'partition', also on a type other than the garage + carport)
//   type      'commercial' can still be in an old saved state (the website itself settles it to 'garage')
// Without these three the CRM would price a customer's 12-gauge upgrade as 14-gauge and drop a storage room (and the doors
// on its wall) without a word.

/** A design in the CRM page's model: the website's own fields renamed / moved. The SAME object when there is nothing to change. */
export function adaptDesign(d) {
  if (!isObj(d)) return d
  const u = isObj(d.upgrades) ? d.upgrades : null
  const siteUp = !!u && (Object.prototype.hasOwnProperty.call(u, 'gauge12') || Object.prototype.hasOwnProperty.call(u, 'vertical'))
  const siteStorage = Object.prototype.hasOwnProperty.call(d, 'storage')
  const commercial = d.type === 'commercial'
  if (!siteUp && !siteStorage && !commercial) return d
  const out = { ...d }
  if (commercial) out.type = 'garage'
  if (siteUp) {
    const { gauge12, vertical, ...rest } = u // eslint-disable-line no-unused-vars
    // the page's other upgrades are simply "no" on the website
    out.upgrades = { insulation: 'none', angle45: false, panels26: false, colorScrews: false, openers: false, ...rest, frame12: u.frame12 === true || gauge12 === true }
  }
  delete out.storage
  return out
}

/**
 * The end storage room the website design asks for: { end:'front'|'back', depth:number|null }, else null.
 * (Not on a garage + carport: its divider is already the split, the website's own rule.)
 */
export function storageOf(d) {
  if (!isObj(d) || !isObj(d.storage) || d.storage.on !== true || d.type === 'combo') return null
  const depth = Number(d.storage.depth)
  return { end: d.storage.end === 'front' ? 'front' : 'back', depth: Number.isFinite(depth) && depth > 0 ? depth : null }
}
