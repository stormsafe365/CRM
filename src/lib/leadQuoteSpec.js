// leadQuoteSpec.js — a lead's Building size + type, filled in from the quote on
// file when the lead itself has none (owner 10/15/26: "some of the working leads
// dont have building info & they should — they should be able to pull that info
// directly from the quote saved on file"). Leads saved from the 3D Builder reach
// Working Leads with a quote but a blank Building column: nothing copies the
// quote's building onto the lead (promoteLead.js, SaveToLeadPicker.jsx).
//
// DISPLAY ONLY — nothing is written back to the lead. A value typed on the lead
// always wins; the quote only fills a blank. Size and type fill independently
// (a lead can have its own size but no type).
//
// WHICH QUOTE: ONE quote — the one Open Layout uses: the starred quote, else the
// newest (quote_date, then created_at) — never a deleted one and never a
// superseded one (replaced by a revised order). The same pick as "Current quote"
// on the lead page and in the Leads drawer (layoutFromQuote.js loadCurrentQuote),
// so a size and its price always come from the same quote. Size and type both come
// from that quote only: if it has no size (an uploaded PDF whose file name had
// none) or no Property Type (a hand-typed or uploaded quote, or the program's
// Property Type left on "— select —"), that blank stays a dash — an older quote
// never fills it (it may be a building the client did not pick).
//
// WHERE THE QUOTE KEEPS THEM:
//   size  quotes.building_size, shown as stored, like the lead's own value. The
//         builder saves width x length x height ("30x40x12", builderSave.js).
//   type  the quote program's Property Type (#pt) and Ag "Tax Exempt?" (#agx),
//         saved at payload_json.fields.pt / .agx (quote-builder.html
//         collectQuoteData). payload_json.card.buildingType is the STRUCTURE
//         (Standard / Wide Span / Carport…), not a building type — never used.
//
// Pure functions + one loader that takes the Supabase client as a parameter
// (unit tests: tests/leadQuoteSpec.test.mjs).
import { sortStarredFirst } from './layoutFromQuote.js'

// ── Property Type -> lead building_type (constants.js BUILDING_TYPES) ──────
const PT_TYPES = { res: 'residential', rc2r: 'risk_cat_2_residential', com: 'commercial', ag: 'agricultural' }
/**
 * Program Property Type (+ Tax Exempt) -> the lead's building_type value, or null.
 * Tax Exempt only counts for Agricultural (the program hides it otherwise). Its
 * default is "No", so Agricultural + "No" shows plain Agricultural.
 */
export function buildingTypeFromQuote(pt, agx) {
  const p = String(pt ?? '').trim().toLowerCase()
  if (p === 'ag') return String(agx ?? '').trim().toLowerCase() === 'yes' ? 'ag_exempt' : 'agricultural'
  return PT_TYPES[p] || null
}
/** A quote row's building type: the light select's pt/agx, or a full row's payload_json.fields. */
export function quoteBuildingType(q) {
  const f = q?.payload_json?.fields || {}
  return buildingTypeFromQuote(q?.pt ?? f.pt, q?.agx ?? f.agx)
}

const text = (v) => (v == null ? '' : String(v).trim())

// ── one lead's quotes -> its quote building info ───────────────────────────
/**
 * { quote, size, type } from one lead's quotes: quote = the lead's current quote
 * (starred, else newest; never deleted / superseded), size + type = that quote's
 * own (null when it has none). All null when the lead has no such quote.
 */
export function specFromQuotes(quotes) {
  const quote = sortStarredFirst((quotes || []).filter((q) => q && q.status !== 'superseded'))[0] || null
  return {
    quote,
    size: quote ? text(quote.building_size) || null : null,
    type: quote ? quoteBuildingType(quote) : null,
  }
}
/** Quote rows for many leads (any order) -> Map(client_id -> spec), only leads whose quotes give something. */
export function specsByClient(rows) {
  const byLead = new Map()
  for (const q of rows || []) {
    if (!q || q.client_id == null) continue
    const list = byLead.get(q.client_id)
    if (list) list.push(q); else byLead.set(q.client_id, [q])
  }
  const out = new Map()
  for (const [id, qs] of byLead) {
    const s = specFromQuotes(qs)
    if (s.size || s.type) out.set(id, s)
  }
  return out
}

// ── what the lead shows ────────────────────────────────────────────────────
/**
 * The lead's Building size + type to display: its own values, blanks filled from
 * its quote spec. sizeFrom / typeFrom = the quote that supplied the value (null
 * when it is the lead's own, or there is none).
 */
export function leadBuildingSpec(client, spec) {
  const ownSize = text(client?.building_size) ? client.building_size : null
  const ownType = text(client?.building_type) ? client.building_type : null
  return {
    size: ownSize ?? spec?.size ?? null,
    type: ownType ?? spec?.type ?? null,
    sizeFrom: !ownSize && spec?.size ? spec.quote || null : null,
    typeFrom: !ownType && spec?.type ? spec.quote || null : null,
  }
}
/** Hover hint on a value that came from a quote: "From quote #SS-2026-12345". */
export function fromQuoteTitle(q) {
  if (!q) return undefined
  return q.quote_number ? `From quote #${q.quote_number}` : 'From the quote on file'
}

// ── loader: one light query for the leads' quotes ──────────────────────────
// Never selects payload_json whole (it carries the 3D thumbnail, price history
// and the full build) — only the two program fields, via PostgREST JSON paths.
// Column sets are tried richest first: with the star (quotes.starred, migration
// 019 — may not be applied) and the JSON paths; then without the star (newest
// wins, as loadCurrentQuote does without the column); then without the JSON paths
// (size only) — still with the star when it exists, so the picked quote stays the
// lead page's Current Quote. Never throws; null = the quotes couldn't be read, and
// the caller keeps showing the leads' own values.
const BASE_COLS = 'id, client_id, quote_number, quote_date, created_at, status, deleted_at, building_size'
const TYPE_COLS = 'pt:payload_json->fields->>pt, agx:payload_json->fields->>agx'
export const SPEC_COL_SETS = [
  `${BASE_COLS}, starred, ${TYPE_COLS}`,
  `${BASE_COLS}, ${TYPE_COLS}`,
  `${BASE_COLS}, starred`,
  BASE_COLS,
]
// Supabase caps one API read (1000 rows by default), so read in pages; a cut-off
// list would silently drop older leads' quotes.
export const SPEC_PAGE = 1000
const MAX_PAGES = 50

async function readAll(sb, cols, clientId) {
  const rows = []
  for (let page = 0, from = 0; page < MAX_PAGES; page++) {
    let q = sb.from('quotes').select(cols)
      .neq('status', 'superseded') // replaced by a revised order: never the lead's quote
    if (clientId) q = q.eq('client_id', clientId)
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + SPEC_PAGE - 1)
    if (error) return { error }
    const got = data || []
    rows.push(...got)
    if (got.length < SPEC_PAGE) break
    from += got.length
  }
  return { rows }
}

/** Map(client_id -> quote spec) for every lead (or just clientId), or null when the quotes can't be read. */
export async function loadQuoteSpecs(sb, clientId = null) {
  for (const cols of SPEC_COL_SETS) {
    try {
      const { rows, error } = await readAll(sb, cols, clientId)
      if (!error) return specsByClient(rows)
    } catch { /* try the next, lighter column set */ }
  }
  return null
}
