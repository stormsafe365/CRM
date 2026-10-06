// revisionDiff.js — "Use as revision" (owner 10/6/26): turn a DUPLICATE that
// already has the changes made into the revised contract for the signed quote
// it revises.
//
// Pricing rule (same as the Revision Order flow): the duplicate is priced at
// TODAY's prices, but the revised contract keeps the ORIGINAL SIGNED price for
// everything that did not change and prices only the changes:
//
//   revised subtotal = signed subtotal + Σ (price of each change)
//
// Each change is priced by the quote program itself (never here): starting from
// the original build at today's prices, the changes are applied one at a time
// and the program reprices after each one; a change's price is the difference.
// The steps add up to (today's price of the new build − today's price of the
// original build) exactly, so nothing that did not change moves off its signed
// price. A change the program can't price is returned unpriced and needs a
// typed amount — nothing here guesses a price.
//
// Pure functions only (no DOM, no React, no Supabase): the price engine is
// injected (priceOf), so this is unit-tested in node (tests/revisionDiff.test.mjs).

export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100
const sameCents = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005
const str = (v) => (v == null ? '' : String(v).trim())

// ── What the comparison looks at ──────────────────────────────────────────
// Fields that never change the build or its price (contact, notes, contract
// page, the price lock's own hidden fields, display-only switches).
const FIELD_IGNORE = new Set([
  'cn', 'cp', 'ce', 'notes', 'rep', 'brs', 'fastener-add',
  'ct-billaddr', 'ct-siteaddr', 'ct-pay', 'ct-elec', 'ct-prim', 'ct-ready', 'ct-honor', 'ct-honor-ref',
  'hold-amt', 'hold-ref', 'hold-src', 'hold-dec', 'add-disc-valid', 'zoning-show', 'adj-note',
  'city', 'county', 'state', // shown with the ZIP (they follow it)
])
// The order's money terms. A revision keeps the signed terms; if they differ the
// automatic comparison stops (a change of discount / tax is not a build change).
export const TERMS_FIELDS = ['disc', 'tax', 'agx', 'add-disc', 'add-disc-type', 'add-disc-show']
// Placement only — never priced (storage partition position: "view + paperwork only").
const PLACEMENT_FIELDS = new Set(['aew-end', 'aew-depth', 'aew-width'])
// Applied together as one change.
const FIELD_GROUPS = [
  { id: 'size', keys: ['bw', 'bl', 'bh'] },
  { id: 'site', keys: ['zip', 'city', 'county', 'state', '_span_city', '_span_county', '_span_state'] },
]
export const FIELD_LABELS = {
  btype: 'Building type', size: 'Building size', site: 'Site (ZIP / county)', pt: 'Building use', perm: 'Permit',
  'cert-ovr': 'Wind certification', 'plans-sel': 'Engineered plans', 'permit-svc': 'Permit service', ws: 'Wall panels',
  rs: 'Roof style', 'framing-upgrade': 'Framing gauge', 'oc-spacing': 'Frame spacing (OC)', 'delivery-type': 'Delivery',
  'pitch-sel': 'Roof pitch', 'sheeting-upgrade': 'Sheeting gauge', cr: 'Roof color', cw: 'Wall color', ct: 'Trim color',
  cwn: 'Wainscot color', wain: 'Wainscot', lap: 'Lap siding', 'insul-sel': 'Insulation', foundation: 'Foundation',
  fastenerAdd: 'Color-matched fasteners', 'adj-amt': 'Price adjustment', 'adj-type': 'Price adjustment type', 'adj-on-h': 'Price adjustment',
  wfg: 'Front gable wall', wbg: 'Back gable wall', wre: 'Right side wall', wle: 'Left side wall', 'add-end-wall': 'Storage partition',
  'aew-end': 'Storage partition end', 'aew-depth': 'Storage partition depth', 'aew-width': 'Storage partition width',
  'gch-enc': 'Enclosed storage length', 'gch-open': 'Open length', 'gch-gable': 'Gable wall', 'gch-left': 'Left side', 'gch-right': 'Right side',
  'overhang-sel': 'Overhang', 'sp-left': 'Left side panels', 'sp-right': 'Right side panels',
  'fs-pitch': 'Lean-to pitch', 'fs-walls-mode': 'Lean-to walls', 'fs-wf': 'Front wall', 'fs-wb': 'Back wall', 'fs-wt': 'Tall side wall',
  'fs-wl2': 'Low side wall', 'fs-orient': 'Orientation',
}

// Building components: the keys that make up WHAT the component is (priced) and
// the keys that only say WHERE it sits (placement — a change there is a "move").
const ITEMS = {
  doors: { noun: 'Roll-up door', wall: 'rloc', place: ['positions'], ignore: ['ovlSeq', 'ovlKeep'] },
  wtds: { noun: 'Walk-through door', wall: 'wloc', place: ['positions'], ignore: ['ovlSeq', 'ovlKeep'] },
  windows: { noun: 'Window', wall: 'nloc', place: ['positions', 'nsill'], ignore: ['ovlSeq', 'ovlKeep'] },
  addcomps: { noun: 'Component', wall: 'fo-loc', place: ['positions', 'fo-sill'], ignore: ['ovlSeq', 'ovlKeep', 'fo-disp-unit'] },
  leantos: { noun: 'Lean-to', wall: 'lts', place: [], ignore: [] },
}
export const ITEM_KINDS = Object.keys(ITEMS)
const ACC_PLACE = ['offs', 'lt-acc-fo-sill']
const ACC_IGNORE = ['ovlSeq', 'ovlKeep']

function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = {}
    Object.keys(v).sort().forEach((k) => { if (v[k] !== undefined) o[k] = canon(v[k]) })
    return o
  }
  return v == null ? '' : String(v)
}
const J = (v) => JSON.stringify(canon(v))

function pick(item, keys) { const o = {}; keys.forEach((k) => { if (item && item[k] !== undefined) o[k] = item[k] }); return o }
function omit(item, keys) { const o = {}; Object.keys(item || {}).forEach((k) => { if (!keys.includes(k) && k !== '__k') o[k] = item[k] }); return o }

// Lean-to: its accessories' placement (offsets) is placement, not what it is.
function leanPriced(lt) {
  const o = omit(lt, ['accs'])
  o.accs = (lt.accs || []).map((a) => omit(a, [...ACC_PLACE, ...ACC_IGNORE]))
  return o
}
function leanPlace(lt) { return (lt.accs || []).map((a) => pick(a, ACC_PLACE)) }

const pricedKey = (kind, it) => (kind === 'leantos' ? J(leanPriced(it)) : J(omit(it, [...ITEMS[kind].place, ...ITEMS[kind].ignore])))
const placeKey = (kind, it) => (kind === 'leantos' ? J(leanPlace(it)) : J(pick(it, ITEMS[kind].place)))
const identKey = (kind, it) => {
  if (kind === 'addcomps') return str(it.act) + '|' + str(it['fo-loc'])
  return str(it[ITEMS[kind].wall])
}

// ── Descriptions ──────────────────────────────────────────────────────────
// labelOf(cls, value) → the program's option text for a select (or null).
const ft = (v) => { const s = str(v); return s ? s + "'" : '' }
// Option text without its price tag ("(+$200)", "— $200", "(+10% of subtotal)").
export function cleanLabel(t) {
  return String(t)
    .replace(/\s*\(\s*[+−-]?\s*\$[\d,.]+[^)]*\)/g, '')
    .replace(/\s*\(\s*\+?[\d.]+%[^)]*\)/g, '')
    .replace(/\s*[—–-]\s*[+−-]?\s*\$[\d,.]+(\s*(each|ea\.?|\/\w+))?/gi, '')
    .replace(/\s+/g, ' ').trim()
}
function lbl(labelOf, cls, v) {
  const s = str(v)
  if (!s) return ''
  try { const t = labelOf && labelOf(cls, s); if (t) return cleanLabel(t) || s } catch { /* fall back to the value */ }
  return s
}
export function itemDesc(kind, it, labelOf) {
  if (!it) return ''
  if (kind === 'doors') {
    const sz = str(it.rsz).replace(/x/i, '×')
    const q = Number(it.rqt) > 1 ? ` (×${it.rqt})` : ''
    const extra = []
    if (str(it.rch) === '1') extra.push('chain hoist')
    if (str(it.rsl) === '1') extra.push('brush seal')
    if (str(it.rop) === '1') extra.push('opener')
    const ty = str(it.rdtype) && !/^(rollup|std|standard)$/i.test(str(it.rdtype)) ? ' ' + lbl(labelOf, 'rdtype', it.rdtype) : ''
    return `Roll-up door${ty} ${sz}${q} — ${str(it.rloc) || '—'}${extra.length ? ` (with ${extra.join(', ')})` : ''}`.replace(/\s+/g, ' ')
  }
  if (kind === 'wtds') {
    const ty = str(it.whi) ? ' ' + lbl(labelOf, 'whi', it.whi) : ''
    const q = Number(it.wqt) > 1 ? ` (×${it.wqt})` : ''
    return `Walk-through door${ty}${q} — ${str(it.wloc) || '—'}`.replace(/\s+/g, ' ')
  }
  if (kind === 'windows') {
    const ty = str(it.ntp) ? ' ' + lbl(labelOf, 'ntp', it.ntp) : ''
    const q = Number(it.nqt) > 1 ? ` (×${it.nqt})` : ''
    return `Window${ty}${q} — ${str(it.nloc) || '—'}`.replace(/\s+/g, ' ')
  }
  if (kind === 'addcomps') {
    const name = str(it.act) || 'Component'
    const size = /Custom Size/i.test(name) && (str(it['fo-cw']) || str(it['fo-ch'])) ? ` (${str(it['fo-cw'])} × ${str(it['fo-ch'])}${str(it['fo-unit']) === 'in' ? ' in' : ' ft'})` : ''
    const q = Number(it.acq) > 1 ? ` (×${it.acq})` : ''
    return `${name}${size}${q}${str(it['fo-loc']) ? ' — ' + str(it['fo-loc']) : ''}`
  }
  if (kind === 'leantos') {
    const side = str(it.lts) || '—'
    const dims = [ft(it.ltw), ft(it.ltl2)].filter(Boolean).join(' × ')
    const ty = str(it['lt-type']) ? ` ${lbl(labelOf, 'lt-type', it['lt-type'])}` : ''
    const acc = (it.accs || []).length ? `, ${(it.accs || []).length} accessor${(it.accs || []).length === 1 ? 'y' : 'ies'}` : ''
    return `Lean-to${ty} — ${side}${dims ? ` (${dims}${acc})` : acc ? ` (${acc.slice(2)})` : ''}`.replace(/\s+/g, ' ')
  }
  return kind
}
const ITEM_KEY_LABELS = {
  rloc: 'wall', rdtype: 'type', rsz: 'size', rqt: 'qty', rch: 'chain hoist', rsl: 'brush seal', rop: 'opener', r45: 'type', rco: 'color',
  wloc: 'wall', whi: 'type', wqt: 'qty', wsf: 'frame', nloc: 'wall', ntp: 'type', nqt: 'qty', nsf: 'frame',
  act: 'component', acq: 'qty', acp: 'price', 'fo-cw': 'width', 'fo-ch': 'height', 'fo-unit': 'unit', 'fo-sf': 'frame', 'fo-loc': 'wall',
  lts: 'side', ltw: 'width', ltl2: 'length', ltoff: 'offset', lth: 'height', ltc: 'color', ltp: 'pitch', 'lt-type': 'type', 'lt-tall-h': 'tall-side height',
  'lt-wm': 'walls', 'lt-wall-front': 'front wall', 'lt-wall-back': 'back wall', 'lt-wall-side': 'side wall', 'lt-stor': 'storage', 'lt-stor-len': 'storage length',
}
function changeDetail(kind, a, b, labelOf) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  const out = []
  keys.forEach((k) => {
    if (k === '__k' || k === 'accs' || ITEMS[kind].place.includes(k) || ITEMS[kind].ignore.includes(k)) return
    if (J(a[k]) === J(b[k])) return
    const name = ITEM_KEY_LABELS[k] || k
    out.push(`${name} ${lbl(labelOf, k, a[k]) || '—'} → ${lbl(labelOf, k, b[k]) || '—'}`)
  })
  if (kind === 'leantos' && J(leanPriced({ accs: a.accs || [] }).accs) !== J(leanPriced({ accs: b.accs || [] }).accs)) {
    out.push(`accessories ${(a.accs || []).length} → ${(b.accs || []).length}${(a.accs || []).length === (b.accs || []).length ? ' (changed)' : ''}`)
  }
  return out.join(', ')
}
function fieldText(labelOf, id, v) {
  if (id === 'fastenerAdd') return v === true || v === 'true' ? 'yes' : 'no'
  return lbl(labelOf, id, v) || 'none'
}

// ── The comparison ────────────────────────────────────────────────────────
// base / next: build payloads (collectQuoteData shape). Returns
//   { blockers: [text], units: [unit] }
// blockers = reasons the automatic comparison can't be used (the rep types the
// changes instead). A unit is one change: kind add | remove | change | move |
// field, plus what to apply (op) for the step-by-step pricing.
export function diffBuilds(base, next, { labelOf = null } = {}) {
  const blockers = []
  const units = []
  if (!base || !next || !base.fields || !next.fields) return { blockers: ['One of the quotes has no saved build.'], units }
  if (str(base.mfr).toUpperCase() !== str(next.mfr).toUpperCase()) blockers.push(`The manufacturer changed (${str(base.mfr) || '—'} → ${str(next.mfr) || '—'}).`)
  if (!!base.inputMode || !!next.inputMode) blockers.push('Manual (Input mode) pricing is on — the price engine can’t price the changes.')
  const bf = base.fields, nf = next.fields
  const termsChanged = TERMS_FIELDS.filter((k) => str(bf[k]) !== str(nf[k]))
  if (termsChanged.length) blockers.push(`The order terms changed (${termsChanged.map((k) => ({ disc: 'discount', tax: 'sales tax', agx: 'ag exemption', 'add-disc': 'additional discount', 'add-disc-type': 'additional discount type', 'add-disc-show': 'additional discount' }[k] || k)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}) — a revision keeps the signed terms. Set them back to the signed quote’s, or type the changes.`)
  let seq = 0
  const uid = () => 'u' + (++seq)

  // Fields: building type + size first (everything else depends on them), then the rest.
  const grouped = new Set()
  const fieldUnit = (id, keys) => {
    const changed = keys.filter((k) => J(bf[k]) !== J(nf[k]) && nf[k] !== undefined)
    if (!changed.length) return null
    keys.forEach((k) => grouped.add(k))
    let desc
    if (id === 'size') desc = `Building size ${[bf.bw, bf.bl, bf.bh].map(str).join('×')} → ${[nf.bw, nf.bl, nf.bh].map(str).join('×')}`
    else if (id === 'site') desc = `Site ${str(bf.zip) || '—'}${str(bf._span_county || bf.county) ? ' (' + str(bf._span_county || bf.county) + ')' : ''} → ${str(nf.zip) || '—'}${str(nf._span_county || nf.county) ? ' (' + str(nf._span_county || nf.county) + ')' : ''}`
    else desc = `${FIELD_LABELS[id] || id}: ${fieldText(labelOf, id, bf[id])} → ${fieldText(labelOf, id, nf[id])}`
    const placement = keys.every((k) => PLACEMENT_FIELDS.has(k))
    return {
      id: uid(), cat: 'field', field: id, kind: placement ? 'move' : 'field', printKind: 'Modify', placement, desc,
      op: { type: 'fields', set: Object.fromEntries(keys.filter((k) => nf[k] !== undefined).map((k) => [k, nf[k]])) },
    }
  }
  const order = ['btype', 'size']
  for (const id of order) {
    const g = FIELD_GROUPS.find((x) => x.id === id)
    const u = fieldUnit(id, g ? g.keys : [id])
    if (u) units.push(u)
  }
  const siteU = fieldUnit('site', FIELD_GROUPS.find((x) => x.id === 'site').keys)
  if (siteU) units.push(siteU)
  const keys = [...new Set([...Object.keys(bf), ...Object.keys(nf)])].sort()
  for (const k of keys) {
    if (grouped.has(k) || FIELD_IGNORE.has(k) || TERMS_FIELDS.includes(k) || k.startsWith('_span_') || k.startsWith('ip-')) continue
    if (k === 'btype') continue
    const u = fieldUnit(k, [k])
    if (u) units.push(u)
  }

  // Components: unchanged (exact), moved (same component, new placement),
  // changed (same wall, different component), removed, added.
  const removes = [], changes = [], adds = [], moves = []
  for (const kind of ITEM_KINDS) {
    const B = (base[kind] || []).map((it, i) => ({ it, i, used: false }))
    const N = (next[kind] || []).map((it, i) => ({ it, i, used: false }))
    const pass = (same) => {
      for (const n of N) {
        if (n.used) continue
        // nearest index first, so a list in the same order pairs up in order
        const cands = B.filter((b) => !b.used && same(b.it, n.it)).sort((x, y) => Math.abs(x.i - n.i) - Math.abs(y.i - n.i))
        if (cands.length) { cands[0].used = true; n.used = true; n.pair = cands[0] }
      }
    }
    pass((a, b) => pricedKey(kind, a) === pricedKey(kind, b) && placeKey(kind, a) === placeKey(kind, b))
    N.forEach((n) => { if (n.pair) n.same = true })
    pass((a, b) => pricedKey(kind, a) === pricedKey(kind, b))
    N.forEach((n) => {
      if (n.pair && !n.same && !n.kindSet) {
        n.kindSet = true
        moves.push({ id: uid(), cat: kind, kind: 'move', printKind: 'Modify', placement: true, baseIndex: n.pair.i, nextIndex: n.i,
          desc: `${itemDesc(kind, n.it, labelOf)} — moved (placement only)`, op: { type: 'replace', kind, baseIndex: n.pair.i, item: n.it } })
      }
    })
    N.forEach((n) => { if (n.pair) n.kindSet = true })
    pass((a, b) => identKey(kind, a) === identKey(kind, b))
    for (const n of N) {
      if (!n.pair || n.kindSet) continue
      n.kindSet = true
      const detail = changeDetail(kind, n.pair.it, n.it, labelOf)
      changes.push({ id: uid(), cat: kind, kind: 'change', printKind: 'Modify', baseIndex: n.pair.i, nextIndex: n.i,
        desc: `${itemDesc(kind, n.it, labelOf)} — changed${detail ? ': ' + detail : ''}`, op: { type: 'replace', kind, baseIndex: n.pair.i, item: n.it } })
    }
    for (const b of B) {
      if (b.used) continue
      removes.push({ id: uid(), cat: kind, kind: 'remove', printKind: 'Remove', baseIndex: b.i, desc: `Remove ${lowerFirst(itemDesc(kind, b.it, labelOf))}`, op: { type: 'remove', kind, baseIndex: b.i } })
    }
    for (const n of N) {
      if (n.used) continue
      adds.push({ id: uid(), cat: kind, kind: 'add', printKind: 'Add', nextIndex: n.i, desc: `Add ${lowerFirst(itemDesc(kind, n.it, labelOf))}`, op: { type: 'add', kind, item: n.it, nextIndex: n.i } })
    }
  }
  units.push(...removes, ...changes, ...adds, ...moves)
  // A field change that is placement-only goes with the moves (end of the list).
  const priced = units.filter((u) => !u.placement)
  const place = units.filter((u) => u.placement)
  return { blockers, units: [...priced, ...place] }
}
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

// Differences between the signed build as saved and the same build reopened
// at today's rules (e.g. a rule that now requires 12-gauge rewrites the
// framing). Those are not changes the rep made, and their price is not in the
// step-by-step pricing — each one comes back as an UNPRICED line (typed amount,
// 0 = no charge). Placement differences are ignored (never priced).
export function reopenDrift(saved, reopened, { labelOf = null } = {}) {
  if (!saved || !reopened || !saved.fields || !reopened.fields) return []
  const out = []
  const sf = saved.fields, rf = reopened.fields
  for (const k of Object.keys(sf).sort()) {
    if (FIELD_IGNORE.has(k) || TERMS_FIELDS.includes(k) || PLACEMENT_FIELDS.has(k) || k.startsWith('_span_') || k.startsWith('ip-')) continue
    if (sf[k] === undefined || rf[k] === undefined) continue
    if (J(sf[k]) === J(rf[k])) continue
    out.push({ id: 'd-' + k, cat: 'drift', kind: 'drift', printKind: 'Modify', unpriced: true,
      reason: 'The signed quote reopens differently under today’s rules',
      desc: `${FIELD_LABELS[k] || k}: ${fieldText(labelOf, k, sf[k])} (as signed) → ${fieldText(labelOf, k, rf[k])} (today’s rules)` })
  }
  for (const kind of ITEM_KINDS) {
    const A = saved[kind] || [], B = reopened[kind] || []
    if (A.length !== B.length) {
      out.push({ id: 'd-' + kind, cat: 'drift', kind: 'drift', printKind: 'Modify', unpriced: true,
        reason: 'The signed quote reopens differently under today’s rules',
        desc: `${ITEMS[kind].noun}s: ${A.length} as signed → ${B.length} on reopen` })
      continue
    }
    A.forEach((a, i) => {
      if (pricedKey(kind, a) === pricedKey(kind, B[i])) return
      out.push({ id: `d-${kind}-${i}`, cat: 'drift', kind: 'drift', printKind: 'Modify', unpriced: true,
        reason: 'The signed quote reopens differently under today’s rules',
        desc: `${itemDesc(kind, a, labelOf)} (as signed) → ${changeDetail(kind, a, B[i], labelOf) || 'changed'} (today’s rules)` })
    })
  }
  return out
}

// ── Applying changes to a build, one at a time ────────────────────────────
// Components carry a private tag (__k) while changes are applied so "remove
// the 2nd window" still finds it after other edits; untag() drops it.
export function tagBuild(payload) {
  const p = JSON.parse(JSON.stringify(payload))
  for (const kind of ITEM_KINDS) p[kind] = (p[kind] || []).map((it, i) => ({ ...it, __k: 'b' + i }))
  return p
}
export function untag(payload) {
  const p = JSON.parse(JSON.stringify(payload))
  for (const kind of ITEM_KINDS) p[kind] = (p[kind] || []).map((it) => { const { __k, ...rest } = it; return rest })
  return p
}
export function applyUnit(work, unit) {
  const p = JSON.parse(JSON.stringify(work))
  const op = unit && unit.op
  if (!op) return p
  if (op.type === 'fields') {
    p.fields = { ...(p.fields || {}), ...JSON.parse(JSON.stringify(op.set)) }
  } else if (op.type === 'remove') {
    p[op.kind] = (p[op.kind] || []).filter((it) => it.__k !== 'b' + op.baseIndex)
  } else if (op.type === 'replace') {
    p[op.kind] = (p[op.kind] || []).map((it) => (it.__k === 'b' + op.baseIndex ? { ...JSON.parse(JSON.stringify(op.item)), __k: it.__k } : it))
  } else if (op.type === 'add') {
    p[op.kind] = [...(p[op.kind] || []), { ...JSON.parse(JSON.stringify(op.item)), __k: 'n' + op.nextIndex }]
  }
  return p
}

// ── Pricing the changes with the program ──────────────────────────────────
// priceOf(payload) → Promise<number> = the program's building subtotal for that
// build at today's prices (pre-discount). Steps through the changes; a step
// that fails leaves that change UNPRICED (typed amount required). nextSub = the
// program's price of the new build: if the steps don't land on it exactly, the
// difference comes back as one unpriced line (never silently absorbed).
export async function priceChanges({ base, units, priceOf, nextSub, onStep = () => {} }) {
  let work = tagBuild(base)
  let prev = await priceOf(untag(work))
  const baseSub = prev
  const lines = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    onStep(i, units.length, u)
    work = applyUnit(work, u)
    let cur = null, err = null
    try { cur = await priceOf(untag(work)) } catch (e) { err = e }
    if (cur == null || !Number.isFinite(Number(cur))) {
      // Stop here: a later step's difference would silently include this one's
      // price. This change and every one after it need a typed amount.
      const why = 'The price engine could not price this change' + (err ? ` (${err.message || err})` : '')
      lines.push({ ...u, unpriced: true, reason: why, amount: null })
      for (let j = i + 1; j < units.length; j++) {
        const v = units[j]
        lines.push(v.placement ? { ...v, amount: 0 } : { ...v, unpriced: true, reason: 'Not priced — an earlier change could not be priced', amount: null })
      }
      return { baseSub: r2(baseSub), finalSub: null, residual: null, lines, stopped: true }
    }
    const amt = r2(Number(cur) - Number(prev))
    if (u.placement && !sameCents(amt, 0)) {
      // A placement-only move is never priced — if the engine says otherwise, the rep decides.
      lines.push({ ...u, unpriced: true, reason: `Placement change, but the price engine moved by ${amt}`, amount: null, engineDelta: amt })
    } else {
      lines.push({ ...u, amount: u.placement ? 0 : amt })
    }
    prev = Number(cur)
  }
  const finalSub = r2(prev)
  const residual = nextSub == null ? 0 : r2(Number(nextSub) - finalSub)
  if (!sameCents(residual, 0)) {
    lines.push({ id: 'residual', cat: 'residual', kind: 'residual', printKind: 'Modify', unpriced: true, engineDelta: residual,
      reason: 'The price engine’s total for the new build differs from the itemized changes',
      desc: 'Other difference between the two builds (not itemized)', amount: null })
  }
  return { baseSub: r2(baseSub), finalSub, residual, lines }
}

// ── The revised order's money ─────────────────────────────────────────────
// signed = { sub, total, deposit, balance }: the signed contract (sub = its
// building subtotal). lines = [{ amount, include }] in subtotal dollars (list
// prices, before discount / tax). forward(sub) = the program's money chain
// (PriceLock.forward bound to the order's terms) → { adjTot, dep, bal, ... }.
// Returns the revised totals, the net change and the adjustment row that makes
// the printed change rows add up to the net change exactly (to the cent).
export function revisionMoney({ signed, lines, forward }) {
  const included = (lines || []).filter((l) => l.include !== false)
  let sum = 0
  for (const l of included) {
    const a = (l.amount == null || String(l.amount).trim() === '') ? NaN : Number(l.amount)
    if (!Number.isFinite(a)) throw new Error(`No amount for “${l.desc || l.id}”`)
    sum += a
  }
  sum = r2(sum)
  const targetSub = r2(Number(signed.sub) + sum)
  const m = forward(targetSub)
  const total = r2(m.adjTot), deposit = r2(m.dep), balance = r2(m.bal)
  const net = r2(total - Number(signed.total))
  const adjustment = r2(net - sum)
  return {
    targetSub, changesSub: sum, total, deposit, balance, net, adjustment, money: m,
    additions: r2(Math.max(net, 0)), credits: r2(Math.max(-net, 0)),
  }
}

// The signed contract's subtotal, checked against its totals: forward(sub) must
// give the signed total / deposit / balance to the cent, or the automatic
// revision can't hold the unchanged items at their signed price.
export function checkSigned({ signed, forward }) {
  if (!signed || !Number.isFinite(Number(signed.sub))) return { ok: false, reason: 'The signed quote’s building price could not be found.' }
  const m = forward(Number(signed.sub))
  const ok = sameCents(m.adjTot, signed.total) && sameCents(m.dep, signed.deposit) && sameCents(m.bal, signed.balance)
  return ok ? { ok: true } : {
    ok: false,
    reason: `The signed totals ($${r2(signed.total).toFixed(2)} / $${r2(signed.deposit).toFixed(2)} / $${r2(signed.balance).toFixed(2)}) can’t be reproduced from its building price and terms ($${r2(m.adjTot).toFixed(2)} / $${r2(m.dep).toFixed(2)} / $${r2(m.bal).toFixed(2)}).`,
  }
}

// Plain-JS copy of the program's money chain (PriceLock.forward: discount →
// tax → deposit % → additional discount), used ONLY by the unit tests; the CRM
// always calls the program's own PriceLock.forward.
export function forwardMoney(sub, p) {
  const da = Math.round(sub * ((+p.disc || 0) / 100)), ad = sub - da
  const ta = p.agx ? 0 : Math.round(ad * ((+p.tax || 0) / 100)), tot = ad + ta
  const gd = Math.round(ad * ((p.depPct || 17) / 100))
  const adv = +p.adVal || 0, am = (p.adType === 'pct') ? Math.round(gd * (adv / 100)) : adv
  return { sub, da, ad, ta, tot, grossDep: gd, addDisc: am, dep: Math.max(0, gd - am), bal: tot - gd, adjTot: tot - am, clamped: (gd - am < 0) }
}

// Lead's quotes for step 1: signed / ordered first, newest first; the quote
// being revised from (the duplicate) is left out.
const SOLD = ['deposit_paid', 'verbal_accept', 'revised']
export function revisionCandidates(quotes, currentId) {
  return (quotes || [])
    .filter((q) => q && q.id !== currentId && !q.deleted_at)
    .map((q) => ({ q, sold: SOLD.includes(q.status), replaced: q.status === 'superseded', builder: !!(q.payload_json && q.payload_json.fields) }))
    // signed / ordered first, an already-replaced quote last
    .sort((a, b) => (Number(b.sold) - Number(a.sold)) || (Number(a.replaced) - Number(b.replaced)) || String(b.q.quote_date || b.q.created_at || '').localeCompare(String(a.q.quote_date || a.q.created_at || '')))
}
