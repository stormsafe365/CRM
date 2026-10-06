// layoutFromQuote: turns a saved quote into a seed for the 2D Layout / Building
// Approval Sheet builder (public/layout, window.SS_LAYOUT.seedFromCRM), and the
// "starred quote" helpers shared by the quote lists.
//
// Owner 10/6/26: "fix the open layout button so it actually reflects the quote i
// need ... I should be able to star one of their quotes ... which one the layout
// button will reflect".
//
// Pure functions only (unit tests: tests/layoutFromQuote.test.mjs). The browser
// side — loading the quote program in a hidden frame and reading its openings —
// lives in quoteLayoutEngine.js.
//
// POSITIONS. The quote program has ONE definition of a typed position (posRefName,
// owner 10/5/26): feet from the named END of the wall to the opening's NEAR edge,
// and its collectElevItems() returns every opening's left edge `x` (1/8" grid) in
// each wall's own frame:
//   front     x from the LEFT eave corner (standing outside, facing the front)
//   back      x from the RIGHT eave corner (standing outside, facing the back)
//   right     x from the FRONT gable
//   left      x from the BACK gable
//   partition x from the left, as seen from the front (End Storage partition;
//             a GCH partition is routed to `front` by the program)
// The layout builder stores `offset` = feet from the wall's reference corner to
// the near edge (layout-src/data.js WALLS): front / back / divider from the LEFT
// eave corner, left / right eaves from the BACK gable. So:
//   front -> offset = x            back  -> offset = W - x - w
//   right -> offset = L - x - w    left  -> offset = x
// computed on the 1/8" grid (1/96 ft), so the layout's numbers are the quote's.

// ── formatting ─────────────────────────────────────────────────────────────
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
/** Snap decimal feet to the program's 1/8" grid (its dimQ). */
export function q8(ft) { const e = Math.round(Number(ft) * 96); return e === 0 ? 0 : e / 96 }
/** 3.2396 ft -> 3′2⅞″ (the program's _dimFtIn, prime marks). */
export function fmtFtIn(ft) {
  const e = Math.round(Number(ft) * 96) || 0
  const neg = e < 0, a = Math.abs(e), f = Math.floor(a / 96), r = a - f * 96
  return (neg ? '−' : '') + (r ? `${f}′${Math.floor(r / 8)}${EIGHTHS[r % 8]}″` : `${f}′`)
}
const money = (n) => (n == null || n === '' || !isFinite(Number(n)) ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
function fmtQuoteDate(q) {
  const d = q?.quote_date || (q?.created_at ? String(q.created_at).slice(0, 10) : '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

// Never put a manufacturer name on anything a customer can see (CLAUDE.md).
const MFR_WORDS = /\b(carports anywhere|carolina carports|eversafe|cci|ca)\b/gi
/** Program option text -> a clean customer-facing label (no price, no maker). */
export function cleanLabel(s) {
  return String(s || '')
    .replace(/\s*[—–-]\s*\$[\d,.]+.*$/, '')
    .replace(/\s*\(\s*[+−-]?\s*\$[^)]*\)/g, '')
    .replace(/\s*\$[\d,.]+/g, '')
    .replace(MFR_WORDS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s—–:-]+|[\s—–:-]+$/g, '')
    .trim()
}

// ── starred quote (one per lead) ───────────────────────────────────────────
export const STAR_TOOLTIP = 'Starred — the quote the client is leaning towards / ordered. Open Layout uses this one.'

/** quotes.starred exists (migration 019 applied)? select('*') rows carry the key. */
export function starSupported(quotes) {
  return Array.isArray(quotes) && quotes.length > 0 && quotes.every((q) => q && Object.prototype.hasOwnProperty.call(q, 'starred'))
}
const live = (quotes) => (quotes || []).filter((q) => q && !q.deleted_at)
// Newest first: quote_date, then created_at (the same order the Quotes box uses).
function newestFirst(a, b) {
  const da = a.quote_date || '', db = b.quote_date || ''
  if (da !== db) return da < db ? 1 : -1
  const ca = a.created_at || '', cb = b.created_at || ''
  return ca === cb ? 0 : (ca < cb ? 1 : -1)
}
/** Newest first, with the starred quote pulled to the front. */
export function sortStarredFirst(quotes) {
  const list = live(quotes).slice().sort(newestFirst)
  const i = list.findIndex((q) => q.starred === true)
  if (i > 0) list.unshift(list.splice(i, 1)[0])
  return list
}
/** The lead's starred quote, else its newest non-deleted one. */
export function pickLayoutQuote(quotes) {
  return sortStarredFirst(quotes)[0] || null
}
/** Local state after starring / unstarring one quote (starring unstars the rest). */
export function applyStar(quotes, id, on) {
  return (quotes || []).map((q) => (q.id === id ? { ...q, starred: !!on } : (on && q.starred ? { ...q, starred: false } : q)))
}
/** "Quote #SS-2026-01234 — 10/06/2026 — $12,345 ★" */
export function quoteOptionLabel(q) {
  return [
    `Quote ${q?.quote_number ? '#' + q.quote_number : '(no number)'}`,
    fmtQuoteDate(q),
    money(q?.total_amount),
  ].filter(Boolean).join(' — ') + (q?.starred ? ' ★' : '')
}
/** Has the quote program's saved build (vs a manually typed quote)? */
export function hasBuild(q) { return !!(q?.payload_json && q.payload_json.fields) }

// ── openings: program elevation items -> layout openings ───────────────────
const FO_KINDS = [
  [/custom frame out/i, 'custom', 'Custom Frame-Out'],
  [/walk-?through/i, 'framed', 'Walk-Through Frame-Out'],
  [/double door/i, 'framed', 'Double Door Frame-Out'],
  [/window/i, 'framed', 'Window Frame-Out'],
  [/side opening/i, 'framed', 'Side Opening (no door)'],
  [/garage door/i, 'framed', 'Garage Door Frame-Out'],
]
/** One program item (+ its entry label) -> layout opening type / name / note. */
export function openingKind(item, label) {
  const lab = label || {}
  if (item.type === 'rollup') return { type: 'rollup', name: '', note: lab.note || '' }
  if (item.type === 'wtd') return { type: 'walk', name: '', note: lab.note || '' }
  if (item.type === 'win') return { type: 'window', name: '', note: lab.note || '' }
  // framed openings (fo)
  const comp = lab.comp || ''
  for (const [re, type, name] of FO_KINDS) if (re.test(comp)) return { type, name, note: lab.note || '' }
  return { type: 'framed', name: 'Frame-Out', note: lab.note || '' }
}

/** Layout offset for an item on a wall (see the header): 1/8" grid. */
export function layoutOffset(wall, x, w, W, L) {
  const e = (v) => Math.round(v * 96)
  if (wall === 'back') return (e(W) - e(x) - e(w)) / 96
  if (wall === 'right') return (e(L) - e(x) - e(w)) / 96
  return e(x) / 96 // front, left, divider
}
const WALL_NAME = { front: 'Front gable', back: 'Back gable', left: 'Left eave', right: 'Right eave' }
const REF_NAME = { front: 'left eave corner', back: 'right eave corner', left: 'back gable', right: 'front gable' }

/**
 * elev = collectElevItems() {front,back,right,left,partition,W,L}; labels = the
 * same arrays of {comp?, note?} in the same order (may be missing). opts.gch:
 * the program's "front" holds the GCH partition -> layout "divider".
 * Returns { openings, notes } — `notes` lists what the layout can't draw
 * (End Storage partition openings).
 */
export function elevToLayoutOpenings(elev, labels, opts = {}) {
  const W = Number(elev?.W) || 0, L = Number(elev?.L) || 0
  const openings = [], notes = []
  for (const k of ['front', 'right', 'back', 'left']) {
    const items = Array.isArray(elev?.[k]) ? elev[k] : []
    const labs = (labels && Array.isArray(labels[k]) && labels[k].length === items.length) ? labels[k] : []
    items.forEach((it, i) => {
      const kind = openingKind(it, labs[i])
      const wall = (k === 'front' && opts.gch) ? 'divider' : k
      openings.push({
        type: kind.type, wall,
        offset: layoutOffset(k === 'front' ? 'front' : k, Number(it.x), Number(it.w), W, L),
        w: q8(it.w), h: q8(it.h || it.w),
        sill: q8(it.yo || 0),
        name: kind.name, note: kind.note,
      })
    })
  }
  const part = Array.isArray(elev?.partition) ? elev.partition : []
  if (part.length) {
    const labs = (labels && Array.isArray(labels.partition) && labels.partition.length === part.length) ? labels.partition : []
    const where = opts.partitionLabel ? ` (${opts.partitionLabel})` : ''
    part.forEach((it, i) => {
      const kind = openingKind(it, labs[i])
      const nm = kind.name || { rollup: 'Roll-Up Door', walk: 'Walk Door', window: 'Window' }[kind.type] || 'Opening'
      notes.push(`Storage partition${where}: ${nm} ${fmtFtIn(it.w)} × ${fmtFtIn(it.h || it.w)}` +
        `${it.yo ? `, sill ${fmtFtIn(it.yo)}` : ''} — ${fmtFtIn(it.x)} from the left eave side (seen from the front) to its near edge`)
    })
  }
  return { openings, notes }
}

// ── building / finishes from the program (or the payload's saved fields) ───
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null }
const LAYOUT_DEFAULT_WIND = 150 // layout-src DEFAULT_BUILDING.wind

/** Program leg style (quote-builder badges, Book 7/16/26): ladder on wide spans, double at 16'+. */
export function legTypeFor(mfr, w, h) {
  const cci = String(mfr || '').toUpperCase() === 'CCI'
  if (cci ? w > 31 : w >= 52) return 'ladder'
  if (h >= 16) return 'double'
  return 'single'
}

/** Match a program color name to the layout catalog (by name), else its hex. */
export function finishKey(catalog, name, hex) {
  const n = String(name || '').trim().toLowerCase()
  if (catalog && n) {
    for (const [key, c] of Object.entries(catalog)) if (String(c.name).toLowerCase() === n) return key
  }
  if (/^#[0-9a-f]{3,8}$/i.test(String(hex || ''))) return String(hex).toUpperCase()
  return n === 'tbd' ? 'TBD' : (hex || '')
}

/**
 * raw = what quoteLayoutEngine reads from the restored program (or
 * rawFromPayload's subset): { fields, mfr, W, L, H, pitch, wind, trussOC,
 * colors:{cr:{name,hex},...}, leanTos:[...] }. catalogs = layout COLOR_CATALOGS
 * colors by mfr ({ca:{key:{name}}, cci:{...}}), optional.
 */
export function buildingFromRaw(raw, catalogs) {
  const f = raw?.fields || {}
  const W = num(raw?.W ?? f.bw) || 0, L = num(raw?.L ?? f.bl) || 0, H = num(raw?.H ?? f.bh) || 0
  const btype = f.btype || ''
  const mfrU = String(raw?.mfr || '').toUpperCase()
  const mfr = mfrU === 'CCI' ? 'cci' : 'ca'
  const pitch = String(raw?.pitch || f._span_pitch || '').trim() || (f['pitch-sel'] && f['pitch-sel'] !== 'standard' ? f['pitch-sel'] : '3:12')
  const wind = num(raw?.wind ?? f['_span_cert-req'])
  const ocSel = f['oc-spacing'] || '5oc'
  const trussOC = num(raw?.trussOC) || ((W <= 24 && btype !== 'widespan' && ocSel !== '4oc') ? 5 : 4)
  const gauge = String(f['framing-upgrade'] || '14') === '12' ? '12' : '14'
  const building = { width: W, length: L, height: H, pitch, trussOC, gauge, legType: legTypeFor(mfrU, W, H) }
  const notes = []
  // The program states a wind certification only with engineered plans
  // (Section 2 "Plans required" = yes). Never invent one: the sheet falls back
  // to the layout's own default (never the previous quote's value) and says so.
  if (wind) building.wind = wind
  else {
    building.wind = LAYOUT_DEFAULT_WIND
    notes.push(`Wind rating: not set on this quote (no engineered plans selected) — ${LAYOUT_DEFAULT_WIND} MPH shown is the layout default; confirm before sending.`)
  }
  if (btype === 'carport') {
    building.config = 'carport'
  } else if (btype === 'gch') {
    const open = num(f['gch-open']) || (num(f['gch-enc']) != null ? L - num(f['gch-enc']) : null)
    building.config = 'hybrid'; building.openEnd = 'front'; building.gableSheet = 'gable'
    if (open != null) building.openLength = open
  } else {
    building.config = 'enclosed'
    if (btype === 'fslean') notes.push('Free-standing lean-to / single-slope building — drawn here as a gable building; see the quote for the roof.')
  }
  if (btype !== 'carport' && btype !== 'gch') {
    for (const [id, nm] of [['wfg', 'Front gable end'], ['wbg', 'Back gable end'], ['wle', 'Left eave side'], ['wre', 'Right eave side']]) {
      const v = f[id]
      if (v && v !== 'Closed') notes.push(`${nm}: ${v === 'Gable Only' ? 'gable-only sheeting' : String(v).toLowerCase()}`)
    }
  }
  const cat = catalogs ? (catalogs[mfr] || null) : null
  const col = raw?.colors || {}
  const fin = (id) => finishKey(cat, col[id]?.name, col[id]?.hex ?? f[id])
  const finishes = { roof: fin('cr'), walls: fin('cw'), trim: fin('ct') }
  const wain = String(f.wain || 'no')
  finishes.hasWainscot = wain !== 'no' && wain !== ''
  if (finishes.hasWainscot) finishes.wainscot = fin('cwn')
  return { building, finishes, mfr, notes }
}

const LT_LOC_NAME = { outer: 'outer wall', front: 'front end wall', back: 'back end wall', partition: 'storage partition' }
const LT_LOC_NAME_GABLE = { outer: 'outer wall', front: 'right-eave end wall', back: 'left-eave end wall', partition: 'storage partition' }
/** One lean-to opening for the note: "1× Walk-Through Door 3′×6′8″ (storage partition)" — the real size, never a stale size field. */
export function ltOpeningText(o, side) {
  const names = /gable/i.test(side || '') ? LT_LOC_NAME_GABLE : LT_LOC_NAME
  const size = o.w > 0 ? ` ${fmtFtIn(o.w)}×${fmtFtIn(o.h)}` : ''
  return `${o.qty || 1}× ${o.label || 'Opening'}${size} (${names[o.loc] || 'outer wall'}${o.xs ? '' : ', position TBD'})`
}

/** Lean-tos -> sheet notes (the sheet also draws them, from seed.geom). */
export function leanToNotes(leanTos) {
  return (leanTos || []).map((l, i) => {
    const n = l.n || i + 1
    const side = l.side || 'lean-to'
    const ref = /eave/i.test(side) ? 'the front gable' : /back/i.test(side) ? 'the right eave corner' : 'the left eave corner'
    const parts = [`Lean-to ${n} — ${side}`]
    if (l.w && l.len) parts.push(`${fmtFtIn(l.w)} W × ${fmtFtIn(l.len)} L`)
    if (l.low) parts.push(`${fmtFtIn(l.low)} low eave`)
    if (l.start != null && l.len) parts.push(`starts ${fmtFtIn(l.start)} from ${ref}`)
    if (l.stor) parts.push(`storage ${fmtFtIn(l.stor.len)} at the ${l.stor.end} end`)
    if (Array.isArray(l.openingList) && l.openingList.length) parts.push(`openings: ${l.openingList.map((o) => ltOpeningText(o, side)).join(', ')}`)
    else if (l.openings) parts.push(`openings: ${l.openings}`)
    return parts.join(', ')
  })
}

/**
 * The full seed for window.SS_LAYOUT.seedFromCRM. raw.elev / raw.labels come
 * from the program; without them (program unavailable / manual quote) the
 * seed carries no openings key and says so in `warning`.
 */
export function seedFromQuote(quote, raw, { client, catalogs } = {}) {
  const f = raw?.fields || {}
  const { building, finishes, mfr, notes } = buildingFromRaw(raw, catalogs)
  const seed = {
    building, finishes, mfr,
    quoteNo: quote?.quote_number || '',
    customer: (f.cn || '').trim() || client?.name || undefined,
    address: (f['ct-siteaddr'] || '').trim() || clientAddress(client) || undefined,
    phone: client?.phone,
  }
  const allNotes = [...notes]
  if (raw?.elev) {
    const W = building.width, L = building.length
    const elev = { ...raw.elev, W: raw.elev.W ?? W, L: raw.elev.L ?? L }
    const res = elevToLayoutOpenings(elev, raw.labels, { gch: building.config === 'hybrid', partitionLabel: raw.partitionLabel })
    seed.openings = res.openings
    allNotes.push(...res.notes)
  } else {
    seed.warning = 'Openings could not be read from this quote — place them by hand.'
  }
  allNotes.push(...leanToNotes(raw?.leanTos))
  seed.notes = allNotes
  // What the paginated sheet draws beyond the openings (lean-tos, frame lines,
  // storage partition, open walls) — only for the quote's own size.
  seed.geom = sheetGeomFromRaw(raw, building)
  return seed
}

/** raw.geom (quoteLayoutEngine.readGeom) -> seed.geom, or null (manual quote / unreadable / size mismatch). */
export function sheetGeomFromRaw(raw, building) {
  const g = raw?.geom
  if (!g || typeof g !== 'object') return null
  const W = Number(building?.width) || 0, L = Number(building?.length) || 0
  if (Number(g.W) !== W || Number(g.L) !== L) return null
  return {
    W, L, H: Number(g.H) || Number(building?.height) || 0,
    truss: Array.isArray(g.truss) ? g.truss.filter((t) => isFinite(t) && t > 0 && t < L) : [],
    oc: Number(g.oc) || 0,
    leanTos: Array.isArray(g.leanTos) ? g.leanTos : [],
    partition: g.partition || null,
    open: g.open || {},
  }
}

export function clientAddress(client) {
  if (!client) return ''
  return [client.address_line, [client.city, client.state].filter(Boolean).join(', '), client.zip].filter(Boolean).join(' ')
}

/** Building + finishes straight from payload_json.fields (no program needed). */
export function rawFromPayload(payload) {
  const f = payload?.fields || {}
  const card = payload?.card || {}
  return {
    fields: f, mfr: payload?.mfr || '',
    colors: { cr: { name: card.roofColor || '', hex: f.cr }, cw: { name: card.wallColor || '', hex: f.cw }, ct: { name: '', hex: f.ct }, cwn: { name: '', hex: f.cwn } },
  }
}

// ── lead page summary "Current Quote" (owner 10/6/26) ─────────────────────
// The starred quote when the lead has one, else the latest (as before). If
// quotes.starred doesn't exist yet (migration 019 not run) the first query
// errors and the latest-quote query runs exactly as it always did.
export const CURRENT_QUOTE_COLS = 'total_amount, manufacturer, quote_number, status'
export async function loadCurrentQuote(sb, clientId) {
  try {
    const { data, error } = await sb.from('quotes')
      .select(CURRENT_QUOTE_COLS + ', starred, deleted_at')
      .eq('client_id', clientId).eq('starred', true).limit(5)
    if (!error) {
      // a starred quote that a revision replaced (superseded) is not the current one
      const s = (data || []).find((q) => !q.deleted_at && q.status !== 'superseded')
      if (s) return s
    }
  } catch { /* fall back to the latest quote */ }
  const { data } = await sb.from('quotes')
    .select(CURRENT_QUOTE_COLS)
    .eq('client_id', clientId)
    .neq('status', 'superseded') // replaced by a revised order: never the current quote
    .order('quote_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
  return (data ?? [])[0] ?? null
}
