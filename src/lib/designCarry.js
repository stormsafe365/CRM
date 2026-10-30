// designCarry: what a customer design keeps from the quote its link started on (owner 10/30/26: "yes build the fix").
//
// A seeded design link opens the customer page on quote #X's building. The page cannot show everything a quote holds:
// lap siding, the 1′ roof overhang, a storage section, side frames on doors / windows, a window's own height, colors that
// are not on the page, a 6:12 roof (older links), the rep's job settings (property type, permits, foundation, delivery) ...
// The customer could not change those, so the new quote keeps them as the rep quoted them. The rep gets one line saying
// what was kept and one saying what was not.
//
//   carryFromQuote(payload, { seedPayload, seedDesign, design, zipSame })
//     payload     = designToQuote's payload for the customer's design (CCI)
//     seedPayload = the seed quote's payload_json, as saved now
//     seedDesign  = the design the link opened on (design_links.seed.design): what the customer was shown
//     design      = the customer's design as sent (settled by the page's rules)
//     zipSame     = the job site is the seed quote's ZIP (permits and delivery follow the county)
//   -> { payload, kept: [words], notKept: [words], carried: bool }
//
// Rules:
//   * Only from a CCI quote (the new quote is CCI; a CA quote's parts and colors are another catalog).
//   * NEVER a price: discounts, price adjustments, typed prices (acp), price snapshots, hold fields and rule overrides
//     (payload.overrides, the wind-certification override) are listed for the rep, never copied.
//   * What the customer COULD change on the page is the customer's: pitch, colors and walls come back from the quote
//     only where the customer left the page's value as the link showed it; a door's details only on a door the customer
//     left as it was (same wall, size and count).
//
// Plain JS (node-testable).

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (v === undefined || v === null ? '' : String(v))
const pf = (v) => parseFloat(v)
const int = (v) => parseInt(v, 10) || 0
const clone = (v) => JSON.parse(JSON.stringify(v))
const hex = (v) => /^#[0-9a-f]{6}$/i.test(str(v))
const WINDOW_SILL = 50 / 12
const isFO = (act) => str(act).indexOf('Framed Opening') === 0
const isCharge = (act) => str(act).indexOf('45°') >= 0 || str(act).indexOf('Double-Tubed') >= 0
const typedPrice = (e) => pf(e && e.acp) > 0
const PART_LOC = 'Partition Wall'

/** "10x8" / "10 x 8" -> "10x8" (numbers), '' when not a size. */
function sizeKey(v) {
  const m = str(v).replace('*', '').match(/^\s*([\d.]+)\s*x\s*([\d.]+)\s*$/i)
  return m ? `${pf(m[1])}x${pf(m[2])}` : ''
}
/** A framed opening's custom size in feet ('' when it has none). */
function foFeet(e) {
  const k = e && e['fo-unit'] === 'in' ? 1 / 12 : 1
  const w = pf(e && e['fo-cw']) * k, h = pf(e && e['fo-ch']) * k
  return w > 0 && h > 0 ? `${Math.round(w * 96) / 96}x${Math.round(h * 96) / 96}` : ''
}
const allOpenings = (d) => (isObj(d) ? [...(Array.isArray(d.openings) ? d.openings : []), ...(Array.isArray(d.leanTos) ? d.leanTos.flatMap((l) => (Array.isArray(l && l.openings) ? l.openings : [])) : [])] : [])

/** Pairs each entry of `mine` with the first unused entry of `theirs` that has the same key. */
function pairUp(mine, theirs, keyOf) {
  const used = new Set()
  const pairs = []
  mine.forEach((e) => {
    const k = keyOf(e)
    if (!k) return
    const j = theirs.findIndex((s, i) => !used.has(i) && keyOf(s) === k)
    if (j >= 0) { used.add(j); pairs.push([e, theirs[j]]) }
  })
  return { pairs, unused: theirs.filter((_, i) => !used.has(i)) }
}

const DOOR_KEY = (e) => `${str(e.rloc)}|${sizeKey(e.rsz)}|${int(e.rqt) || 1}`
const WALK_KEY = (e) => `${str(e.wloc)}|${str(e.whi ?? e.wtype)}|${int(e.wqt) || 1}`
const WIN_KEY = (e) => `${str(e.nloc)}|${str(e.ntp ?? e.ntype)}|${int(e.nqt) || 1}`
const FO_KEY = (e) => (isFO(e.act) && !isCharge(e.act) ? `${str(e.act)}|${str(e['fo-loc'])}|${int(e.acq) || 1}|${foFeet(e)}` : '')
const ACC_KEY = (a) => {
  const t = str(a['lt-acc-type'] || 'rollup')
  const look = t === 'rollup' ? sizeKey(a['lt-acc-size']) : t === 'wtd' ? str(a['lt-acc-wtd-hi']) : t === 'win' ? str(a['lt-acc-win-hi']) : `${str(a['lt-acc-fo-type'])}|${pf(a['lt-acc-fo-w'])}x${pf(a['lt-acc-fo-h'])}`
  return `${t}|${str(a['lt-acc-loc'] || 'outer')}|${look}|${int(a['lt-acc-qty']) || 1}`
}

export function carryFromQuote(payload, { seedPayload, seedDesign = null, design = null, zipSame = false } = {}) {
  const kept = [], notKept = []
  if (!isObj(payload) || !isObj(payload.fields) || !isObj(seedPayload) || !isObj(seedPayload.fields)) return { payload, kept, notKept, carried: false }
  if (str(seedPayload.mfr).toUpperCase() !== 'CCI') {
    notKept.push('anything from it (it was quoted with the other manufacturer: its parts and colors are not in the CCI catalog)')
    return { payload, kept, notKept, carried: false }
  }
  const out = clone(payload)
  const f = out.fields, sf = seedPayload.fields
  const d = isObj(design) ? design : {}
  const sd = isObj(seedDesign) ? seedDesign : null
  const list = (p, k) => (Array.isArray(p[k]) ? p[k].filter(isObj) : [])
  const gch = f.btype === 'gch', seedGch = sf.btype === 'gch'

  // ── job settings the page never asks ───────────────────────────────────────────────────────────────────────
  const job = []
  const copy = (k) => { if (str(sf[k]) !== '' && !(k in f)) { f[k] = sf[k]; return true } return false }
  if (copy('pt')) { copy('agx'); job.push('property type') }
  if (copy('foundation')) job.push('foundation')
  const county = ['perm', 'plans-sel', 'permit-svc', 'delivery-type'].filter((k) => str(sf[k]) !== '')
  if (county.length) {
    if (zipSame) {
      county.forEach(copy)
      if (str(sf.perm) !== '') job.push('permits / plans')
      if (str(sf['delivery-type']) !== '') job.push('delivery')
    } else notKept.push('permits / plans and delivery (the job site’s ZIP is not the quote’s: set them for this county)')
  }
  if (copy('notes')) job.push('the quote’s notes')
  if (job.length) kept.push(job.join(', '))

  // ── building extras the page cannot show ───────────────────────────────────────────────────────────────────
  if (sf.lap === 'yes' && f.lap !== 'yes') { f.lap = 'yes'; kept.push('lap siding') }
  if (str(sf['overhang-sel']) && sf['overhang-sel'] !== 'none' && !('overhang-sel' in f)) { f['overhang-sel'] = sf['overhang-sel']; kept.push('the roof overhang') }
  const seedStorage = !seedGch && str(sf['add-end-wall']) && sf['add-end-wall'] !== 'no'
  let storageKept = false
  if (seedStorage) {
    if (gch) notKept.push('the storage section (the building is a garage + carport now)')
    else if ('add-end-wall' in f) notKept.push('the quote’s storage section (the customer drew a storage room of their own)')
    else {
      ['add-end-wall', 'aew-end', 'aew-depth', 'aew-width'].forEach(copy)
      storageKept = true
      kept.push('the storage section')
    }
  }
  // doors / windows on the storage wall (the page has no such wall outside a garage + carport)
  if (!seedGch) {
    const part = { doors: list(seedPayload, 'doors').filter((e) => e.rloc === PART_LOC), wtds: list(seedPayload, 'wtds').filter((e) => e.wloc === PART_LOC), windows: list(seedPayload, 'windows').filter((e) => e.nloc === PART_LOC), addcomps: list(seedPayload, 'addcomps').filter((e) => isFO(e.act) && e['fo-loc'] === PART_LOC) }
    const n = Object.values(part).reduce((s, l) => s + l.length, 0)
    if (n && storageKept) {
      for (const k of Object.keys(part)) {
        if (!part[k].length) continue
        out[k] = [...list(out, k), ...part[k].map((e) => { const c = clone(e); delete c.acp; return c })]
      }
      kept.push(`the door${n === 1 ? '' : 's'} / window${n === 1 ? '' : 's'} on the storage wall`)
    } else if (n) notKept.push('the doors / windows on the storage wall')
  }
  // other additional components (gutters, trim, 45° cut charges ...): priced by the program, never a typed price
  const others = list(seedPayload, 'addcomps').filter((e) => !isFO(e.act) || isCharge(e.act))
  const priced = others.filter((e) => typedPrice(e) || e.act === 'Custom — see notes')
  const take = others.filter((e) => !priced.includes(e) && str(e.act))
  if (take.length) {
    out.addcomps = [...list(out, 'addcomps'), ...take.map((e) => { const c = clone(e); delete c.acp; return c })]
    kept.push(take.map((e) => `${str(e.act).replace('Framed Opening — ', '')}${int(e.acq) > 1 ? ` ×${int(e.acq)}` : ''}`).join(', '))
  }
  if (priced.length) notKept.push(`${priced.map((e) => str(e.act)).join(', ')} (a typed price: add it again with today’s price)`)
  // lean-tos the page has no place for
  const seedLts = list(seedPayload, 'leantos')
  const free = seedLts.filter((e) => str(e['lt-type']) === 'freestanding')
  if (free.length) {
    out.leantos = [...list(out, 'leantos'), ...free.map(clone)]
    kept.push(`${free.length} free-standing lean-to${free.length === 1 ? '' : 's'}`)
  }

  // ── what the customer left as the link showed it ───────────────────────────────────────────────────────────
  const looks = []
  if (sd) {
    if (d.pitch === sd.pitch && str(sf['pitch-sel']) && sf['pitch-sel'] !== f['pitch-sel'] && ['standard', '4:12', '5:12', '6:12'].includes(sf['pitch-sel'])) {
      f['pitch-sel'] = sf['pitch-sel']
      kept.push(`the ${sf['pitch-sel'] === 'standard' ? 'standard' : sf['pitch-sel']} roof pitch`)
    }
    const dc = isObj(d.colors) ? d.colors : {}, sc = isObj(sd.colors) ? sd.colors : {}
    for (const [k, role] of [['cr', 'roof'], ['cw', 'walls'], ['ct', 'trim']]) {
      if (dc[role] === sc[role] && hex(sf[k]) && str(sf[k]).toUpperCase() !== str(f[k]).toUpperCase()) { f[k] = sf[k]; looks.push(role) }
    }
    if (d.wainscot && sd.wainscot && sf.wain === 'yes' && dc.wainscot === sc.wainscot && hex(sf.cwn) && str(sf.cwn).toUpperCase() !== str(f.cwn).toUpperCase()) { f.cwn = sf.cwn; looks.push('wainscot') }
    if (looks.length) kept.push(`the quote’s exact ${looks.join(' / ')} color${looks.length === 1 ? '' : 's'}`)
    // walls: same building type, the wall left as shown (a side's panel bands go by the wall height, so a side also
    // needs the same height)
    if (d.type === sd.type && isObj(d.walls) && isObj(sd.walls)) {
      const sides = []
      const take2 = (pageKey, keys) => {
        if (d.walls[pageKey] !== sd.walls[pageKey]) return
        if ((pageKey === 'left' || pageKey === 'right') && d.height !== sd.height) return
        let changed = false
        for (const k of keys) if (str(sf[k]) !== '' && str(sf[k]) !== str(f[k])) { f[k] = sf[k]; changed = true }
        if (changed) sides.push(pageKey === 'left' ? 'left side' : pageKey === 'right' ? 'right side' : `${pageKey} end`)
      }
      if (gch) {
        take2('left', ['gch-left', 'wle']); take2('right', ['gch-right', 'wre']); take2('front', ['wfg']); take2('back', ['wbg'])
        if (d.length === sd.length && d.enclosedLength === sd.enclosedLength) for (const k of ['gch-enc', 'gch-open']) if (str(sf[k]) !== '' && str(sf[k]) !== str(f[k])) f[k] = sf[k]
      } else if (f.btype === 'carport') {
        take2('left', ['sp-left']); take2('right', ['sp-right']); take2('front', ['wfg']); take2('back', ['wbg'])
      } else {
        take2('left', ['wle']); take2('right', ['wre']); take2('front', ['wfg']); take2('back', ['wbg'])
      }
      if (sides.length) kept.push(`the ${sides.join(', ')} wall${sides.length === 1 ? '' : 's'} as quoted`)
    }
  }

  // ── details on the doors / windows the customer left as they were ──────────────────────────────────────────
  const shown = allOpenings(sd)
  const linkHadHoist = shown.some((o) => o && o.hoist === true)
  const linkHadSeal = shown.some((o) => o && o.seal === true)
  const openersSame = !!sd && !!(d.upgrades && d.upgrades.openers) === !!(sd.upgrades && sd.upgrades.openers)
  const cutSame = !!sd && !!(d.upgrades && d.upgrades.angle45) === !!(sd.upgrades && sd.upgrades.angle45)
  let details = 0
  const lost = []
  const setIf = (e, k, v) => { if (str(v) !== '' && str(e[k]) !== str(v)) { e[k] = v; return true } return false }
  const capQ = (v, q) => String(Math.min(int(q) || 1, int(v)))

  const mainDoors = list(out, 'doors').filter((e) => e.rloc !== PART_LOC)
  const r1 = pairUp(mainDoors, list(seedPayload, 'doors').filter((e) => e.rloc !== PART_LOC), DOOR_KEY)
  for (const [e, s] of r1.pairs) {
    let did = false
    if (openersSame && str(s.rop) !== '') did = setIf(e, 'rop', capQ(s.rop, e.rqt)) || did
    if (cutSame && str(s.r45) !== '') did = setIf(e, 'r45', s.r45) || did
    // a link made before the page had hoists / seals (10/30/26) showed none: the quote's own stay
    if (!linkHadHoist && int(s.rch) > 0 && str(e.rch) === '0') did = setIf(e, 'rch', capQ(s.rch, e.rqt)) || did
    if (!linkHadSeal && int(s.rsl) > 0 && str(e.rsl) === '0') did = setIf(e, 'rsl', capQ(s.rsl, e.rqt)) || did
    if (did) details++
  }
  for (const s of r1.unused) {
    const what = [(!linkHadHoist && int(s.rch) > 0) && 'chain hoist', (!linkHadSeal && int(s.rsl) > 0) && 'brush seal', int(s.rop) > 0 && int(s.rop) < (int(s.rqt) || 1) && 'openers on some doors'].filter(Boolean)
    if (what.length) lost.push(`${sizeKey(s.rsz)} roll-up (${str(s.rloc).replace(/ (Gable End|Eave Side)$/, '').toLowerCase()}): ${what.join(', ')}`)
  }
  const r2 = pairUp(list(out, 'wtds').filter((e) => e.wloc !== PART_LOC), list(seedPayload, 'wtds').filter((e) => e.wloc !== PART_LOC), WALK_KEY)
  for (const [e, s] of r2.pairs) if (int(s.wsf) > 0 && setIf(e, 'wsf', capQ(s.wsf, e.wqt))) details++
  for (const s of r2.unused) if (int(s.wsf) > 0) lost.push(`walk door (${str(s.wloc).replace(/ (Gable End|Eave Side)$/, '').toLowerCase()}): side frame`)
  const r3 = pairUp(list(out, 'windows').filter((e) => e.nloc !== PART_LOC), list(seedPayload, 'windows').filter((e) => e.nloc !== PART_LOC), WIN_KEY)
  for (const [e, s] of r3.pairs) {
    let did = false
    if (int(s.nsf) > 0) did = setIf(e, 'nsf', capQ(s.nsf, e.nqt)) || did
    const sill = pf(s.nsill)
    if (Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) did = setIf(e, 'nsill', s.nsill) || did
    if (did) details++
  }
  for (const s of r3.unused) {
    const sill = pf(s.nsill)
    const what = [int(s.nsf) > 0 && 'side frame', Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9 && `height off the floor ${s.nsill}′`].filter(Boolean)
    if (what.length) lost.push(`window (${str(s.nloc).replace(/ (Gable End|Eave Side)$/, '').toLowerCase()}): ${what.join(', ')}`)
  }
  const r4 = pairUp(list(out, 'addcomps').filter((e) => FO_KEY(e) && e['fo-loc'] !== PART_LOC), list(seedPayload, 'addcomps').filter((e) => FO_KEY(e) && e['fo-loc'] !== PART_LOC), FO_KEY)
  for (const [e, s] of r4.pairs) {
    let did = false
    const sill = pf(s['fo-sill'])
    if ('fo-sill' in e && Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) did = setIf(e, 'fo-sill', s['fo-sill']) || did
    if (int(s['fo-sf']) > 0) did = setIf(e, 'fo-sf', s['fo-sf']) || did
    // the rep's own units for a custom size (38" x 39" stays in inches); the same size either way
    if (foFeet(s) && foFeet(s) === foFeet(e) && s['fo-unit'] === 'in') { for (const k of ['fo-unit', 'fo-cw', 'fo-ch', 'fo-disp-unit']) setIf(e, k, s[k]) }
    if (typedPrice(s)) lost.push(`${str(s.act).replace('Framed Opening — ', 'framed opening ')}: its typed price`)
    if (did) details++
  }
  for (const s of r4.unused) {
    const sill = pf(s['fo-sill'])
    if (Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) lost.push(`${str(s.act).replace('Framed Opening — ', 'framed opening ')} (${str(s['fo-loc']).replace(/ (Gable End|Eave Side)$/, '').toLowerCase()}): height off the floor ${s['fo-sill']}′`)
  }

  // lean-tos: same side, same size = the quote's lean-to
  const ltShown = sd && Array.isArray(sd.leanTos) ? sd.leanTos : []
  for (const e of list(out, 'leantos')) {
    if (str(e['lt-type']) === 'freestanding') continue
    const s = seedLts.find((x) => str(x['lt-type'] || 'attached') !== 'freestanding' && x.lts === e.lts)
    if (!s) continue
    const sameSize = pf(e.ltw) === pf(s.ltw) && int(e.ltl2) === int(s.ltl2)
    if (sameSize && (s['lt-stor'] === 'front' || s['lt-stor'] === 'back') && !e['lt-stor']) { e['lt-stor'] = s['lt-stor']; if (str(s['lt-stor-len']) !== '') e['lt-stor-len'] = s['lt-stor-len']; kept.push(`the ${str(e.lts).replace(/ (Gable|Eave)$/, '').toLowerCase()} lean-to’s storage section`) }
    // its walls as quoted (4 / 5 panels from the top showed as closed) when the customer left them as shown
    const dl = Array.isArray(d.leanTos) ? d.leanTos.find((l) => l && l.side === e.lts) : null
    const sl = ltShown.find((l) => l && l.side === e.lts)
    if (dl && sl && dl.enclosure === sl.enclosure && JSON.stringify(dl.walls) === JSON.stringify(sl.walls) && e['lt-wm'] === s['lt-wm']) {
      for (const k of ['lt-wall-front', 'lt-wall-back', 'lt-wall-side']) if (k in s && setIf(e, k, s[k])) details++
    }
    const ra = pairUp(Array.isArray(e.accs) ? e.accs.filter(isObj) : [], Array.isArray(s.accs) ? s.accs.filter(isObj) : [], ACC_KEY)
    for (const [a, b] of ra.pairs) {
      let did = false
      if (int(b['lt-acc-sf']) > 0) did = setIf(a, 'lt-acc-sf', b['lt-acc-sf']) || did
      if (!linkHadHoist && int(b['lt-acc-ch']) > 0 && str(a['lt-acc-ch']) === '0') did = setIf(a, 'lt-acc-ch', b['lt-acc-ch']) || did
      if (!linkHadSeal && int(b['lt-acc-sl']) > 0 && str(a['lt-acc-sl']) === '0') did = setIf(a, 'lt-acc-sl', b['lt-acc-sl']) || did
      const sill = pf(b['lt-acc-fo-sill'])
      if ('lt-acc-fo-sill' in a && Number.isFinite(sill) && Math.abs(sill - WINDOW_SILL) > 1 / 96 + 1e-9) did = setIf(a, 'lt-acc-fo-sill', b['lt-acc-fo-sill']) || did
      if (did) details++
    }
  }
  if (details) kept.push(`door / window details (chain hoists, brush seals, side frames, openers, 45° cuts, heights off the floor) on ${details} part${details === 1 ? '' : 's'} the customer left as they were`)
  if (lost.length) notKept.push(`details on doors / windows the customer changed or removed — ${lost.join('; ')}`)

  // ── never carried: prices and overrides ────────────────────────────────────────────────────────────────────
  const money = []
  if (pf(sf.disc) > 0) money.push(`a ${sf.disc}% discount`)
  if (pf(sf['add-disc']) > 0) money.push(`an extra discount (${sf['add-disc-type'] === 'pct' ? `${sf['add-disc']}%` : `$${sf['add-disc']}`})`)
  if (pf(sf['adj-amt']) > 0) money.push(`a price adjustment ($${sf['adj-amt']}${str(sf['adj-note']) ? `, “${str(sf['adj-note']).slice(0, 60)}”` : ''})`)
  if (money.length) notKept.push(`${money.join(', ')} — prices are never copied: apply again if it still stands`)
  if (str(sf['cert-ovr']) && sf['cert-ovr'] !== 'auto') notKept.push(`wind certification set to ${sf['cert-ovr']} MPH (an override: set it again if it still applies)`)
  const ov = isObj(seedPayload.overrides) ? seedPayload.overrides : {}
  if (ov.fu14 || ov.imp || ov.lap || ov.ns) notKept.push('rep overrides (14-gauge, impact, lap siding or material-only): set them again if they still apply')
  const second = []
  const seenSide = new Set()
  for (const e of seedLts) {
    if (str(e['lt-type']) === 'freestanding') continue
    if (seenSide.has(e.lts)) second.push(e.lts)
    seenSide.add(e.lts)
  }
  if (second.length) notKept.push(`a second lean-to on the same side (${second.map((s) => str(s).toLowerCase()).join(', ')})`)

  return { payload: out, kept, notKept, carried: kept.length > 0 }
}

/**
 * The seed quote's notes ("what the page could not show") that carryFromQuote did NOT answer, so the rep is not told twice.
 * Everything matched here is either kept (designCarry) or the customer's own choice now.
 */
const HANDLED = [
  /^Roof pitch 6:12/, /^Lap siding/, /roof overhang/, /^Storage section/, /^Door options/, /^Side frames/, /Window height off the floor/,
  /color (was not chosen|is not on the page)/, /^Printed wainscot/, /colors? (other than|are matched)/i, /^Roll-up door openers/,
  /45° angle cuts/, /storage partition wall/, /is not a page choice/, /reaches the full wall height/, /lean-to’s storage section/,
  /panels from the top, which the page does not have/, /free-standing lean-to/, /^Rep overrides/, /second lean-to/,
  /^The front end of a garage \+ carport/, /^The back end of a garage \+ carport/, /^The garage and carport parts/,
]
export function notesLeft(notes) {
  return (Array.isArray(notes) ? notes : []).filter((n) => typeof n === 'string' && n.trim() && !HANDLED.some((re) => re.test(n)))
}
