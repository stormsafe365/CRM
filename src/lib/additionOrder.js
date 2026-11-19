// additionOrder.js - an ADDITION ORDER: something added to a building the customer already has (a walk-in door into the
// framed opening that is there, a window...). Owner 11/19/26, after Robert Andrews' door-only order for CCI: "is there a
// way to make one of these for people moving forward through our crm ?" CCI asked for "the correct order date": an
// addition is its own order, dated the day it is made, numbered from the agreement it adds to (SS-2026-79957-A, -B...).
// Pure functions (tests/additionOrder.test.mjs); the box is components/AdditionOrderModal, the document lib/additionHtml.
//
// PRICES: never typed here. The door and window prices come from the quote program (MANUFACTURERS[mfr].wtdTypes /
// wtdPrices / winTypes / winPrices, read live through the hidden price engine - lib/revisionPricing loadPriceEngine).
// Sales tax: the program's COUNTY_TAX for the job's county (its default 6% when the county is not in the list).
// Deposit: the program's 17% of the price before tax (qMoney: Math.round(ad * 17 / 100)), whole dollars like the program.
// CCI ADDITION FEE: $200 - CCI Dealer Handbook: any addition to an existing building gets a $200 delivery fee (no
// commission); CCI terms 3.b.ii: a service charge of at least $200 to return and install an addition. Not taxed (as on
// Robert's order, 11/19/26). CA: no confirmed fee yet - the rep types it (0 = none).
import { agreementRootOf, signedOnOf } from './contractDocs.js'

const str = (v) => (v == null ? '' : String(v).trim())
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const ADDITION_FEE = {
  CCI: { amount: 200, note: 'CCI: $200 on any addition to an existing building (Dealer Handbook; terms 3.b.ii). Not taxed.' },
  CA: { amount: null, note: "Carports Anywhere's fee for an addition is not confirmed yet - ask CA, then type it (0 if none). Not taxed." },
}
export const DEPOSIT_PCT = 17

// CCI's impact counties - the same lists as the quote program (rc() / PriceLock IMPACT_CO, IMPACT_WIN_CO; CCI memo 3/9/26
// "Florida Impact Window & High Wind Rated Walk In Door Guide"). tests/additionOrder.test.mjs checks they still match it.
export const IMPACT_CO = ['Charlotte', 'Collier', 'Hillsborough', 'Indian River', 'Lee', 'Manatee', 'Palm Beach', 'Sarasota', 'St. Lucie']
export const IMPACT_WIN_CO = ['Duval', 'Orange', 'Pasco', 'Pinellas', 'Volusia']
const IMPACT_SQFT_CO = ['Okaloosa', 'Okeechobee'] // over 720 sq ft
export const IMPACT_WIN_OK = ['hi', 'hi3036']
export const HIWIND_DOOR = 'hiwind'

/** { doors, windows }: CCI's county rule - doors = High-Wind rated walk-in doors only, windows = Hi-Impact windows only.
 *  CA: no county lock (the program has none for CA). sqft = the existing building's width x length. */
export function impactRuleFor(mfr, county, sqft = 0) {
  if (str(mfr).toUpperCase() !== 'CCI') return { doors: false, windows: false }
  const co = str(county)
  const doors = IMPACT_CO.includes(co) || (IMPACT_SQFT_CO.includes(co) && Number(sqft) > 720)
  return { doors, windows: doors || IMPACT_WIN_CO.includes(co) }
}

export const KINDS = [
  { v: 'wtd', label: 'Walk-in door' },
  { v: 'win', label: 'Window' },
  { v: 'other', label: 'Other (type it)' },
]
export const WALLS = ['Front gable end', 'Back gable end', 'Left side', 'Right side']

/** The program's walk-in doors and windows for a manufacturer: { wtd:[{v,label,price,locked}], win:[...] }.
 *  mdef = MANUFACTURERS[mfr] from the program. locked = not allowed in this county (CCI impact rule). */
export function additionCatalog(mdef, rule = { doors: false, windows: false }) {
  const list = (types, prices, lockFn) => (Array.isArray(types) ? types : [])
    .filter((t) => t && t.v != null && prices && Number(prices[t.v]) > 0)
    .map((t) => ({ v: String(t.v), label: String(t.label || t.v), price: Number(prices[t.v]), locked: lockFn(String(t.v)) }))
  return {
    wtd: list(mdef && mdef.wtdTypes, mdef && mdef.wtdPrices, (v) => !!rule.doors && v !== HIWIND_DOOR),
    win: list(mdef && mdef.winTypes, mdef && mdef.winPrices, (v) => !!rule.windows && !IMPACT_WIN_OK.includes(v)),
  }
}

/** The first allowed type of a kind ('' when none). */
export function defaultType(catalog, kind) {
  const l = (catalog && catalog[kind]) || []
  const ok = l.filter((t) => !t.locked)
  // a locked county starts on the required door / window (the program's lock: hi-wind door, 30x30 Hi-Impact window)
  return (ok[0] && ok[0].v) || ''
}

/** A new item row. */
export function newItem(catalog, kind = 'wtd') {
  return { kind, type: kind === 'other' ? '' : defaultType(catalog, kind), qty: 1, wall: '', framed: kind === 'wtd', desc: '', price: '' }
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const plural = (n, one, many) => `${WORDS[n] || n} ${n === 1 ? one : many}`
/** One item's printed line: { desc, qty, unit, amount, ok, why }. */
export function itemLine(item, catalog) {
  const qty = Math.max(1, Math.floor(Number(item && item.qty) || 1))
  const where = str(item && item.wall)
  if (item && item.kind === 'other') {
    const unit = r2(item.price)
    const desc = str(item.desc)
    const ok = !!desc && unit > 0
    return { kind: 'other', desc: desc + (where ? ` — ${where}` : ''), qty, unit, amount: r2(unit * qty), ok, why: ok ? '' : (!desc ? 'Type what the item is.' : 'Type its price.') }
  }
  const t = ((catalog && catalog[item && item.kind]) || []).find((x) => x.v === str(item && item.type))
  if (!t) return { kind: item && item.kind, desc: '', qty, unit: 0, amount: 0, ok: false, why: 'Pick the model.' }
  if (t.locked) return { kind: item.kind, desc: t.label, qty, unit: t.price, amount: r2(t.price * qty), ok: false, why: item.kind === 'wtd' ? 'This county needs a High-Wind rated walk-in door.' : 'This county needs a Hi-Impact window.' }
  const framed = item.kind === 'wtd' && item.framed
  const tail = [where, framed ? 'into the existing framed opening' : ''].filter(Boolean).join(', ')
  return { kind: item.kind, desc: t.label + (tail ? ` — ${tail}` : ''), label: t.label, qty, unit: t.price, amount: r2(t.price * qty), ok: true, why: '' }
}

/** The order's money: { lines, sub, taxPct, tax, fee, total, depPct, deposit, waived, balance, ok, why }.
 *  Tax and the deposit are whole dollars, as in the program's qMoney. */
export function priceAddition({ items = [], catalog, taxPct = 0, fee = 0, waived = false, depPct = DEPOSIT_PCT } = {}) {
  const lines = items.map((it) => itemLine(it, catalog))
  const sub = r2(lines.reduce((a, l) => a + l.amount, 0))
  const tp = Math.max(0, Number(taxPct) || 0)
  const tax = Math.round(sub * (tp / 100))
  const f = Math.max(0, r2(fee))
  const total = r2(sub + tax + f)
  const deposit = waived ? 0 : Math.round(sub * ((Number(depPct) || 0) / 100))
  const bad = lines.find((l) => !l.ok)
  const why = !lines.length ? 'Add what is being added.' : bad ? bad.why : ''
  return { lines, sub, taxPct: tp, tax, fee: f, total, depPct: Number(depPct) || 0, deposit, waived: !!waived, balance: r2(total - deposit), ok: !why, why }
}

// ── numbering: the agreement's number + "-A", "-B"... ─────────────────────────────────────────────
export const ADD_RE = /(SS-\d{4}-\d{5})-([A-Z])(?=[-_.\s(]|$)/
/** The agreement number additions are numbered from: the signed paper's number, else the quote's. */
export function additionRootOf(q) { return agreementRootOf(q) || str(q && q.quote_number) || null }
/** Every addition saved on the lead's quotes: [{ quote, add }], oldest first. */
export function additionsOf(quotes) {
  const out = []
  for (const q of quotes || []) {
    if (!q || q.deleted_at) continue
    const list = q.payload_json && Array.isArray(q.payload_json.additions) ? q.payload_json.additions : []
    for (const add of list) if (add && add.number) out.push({ quote: q, add })
  }
  return out.sort((a, b) => str(a.add.createdAt).localeCompare(str(b.add.createdAt)))
}
/** The next free letter for `root` on this lead (its saved additions and any contract file named "<root>-X"). */
export function nextAdditionNumber(root, quotes, fileLabels = []) {
  const used = new Set()
  for (const { add } of additionsOf(quotes)) { const m = ADD_RE.exec(str(add.number)); if (m && m[1] === root) used.add(m[2]) }
  for (const l of fileLabels || []) { const m = ADD_RE.exec(str(l)); if (m && m[1] === root) used.add(m[2]) }
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c)
    if (!used.has(letter)) return { letter, number: `${root}-${letter}` }
  }
  return null
}

// ── what the box starts with ──────────────────────────────────────────────────────────────────────
// the quote's manufacturer; a hand-added quote with none: the program's save, else the lead's (Lead > Manufacturer), else CCI
const MFR_KEY = (q, client = null) => {
  for (const v of [q && q.manufacturer, q && q.payload_json && q.payload_json.mfr, client && client.building_mfr]) {
    const m = str(v).toLowerCase()
    if (m === 'ca') return 'CA'
    if (m === 'cci') return 'CCI'
  }
  return 'CCI'
}
export const mfrOf = MFR_KEY
const ft = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null }
/** "24′ × 20′ × 12′" (W × L × H) from the saved build, else the card's "24x20x12". */
export function buildingSizeOf(q) {
  const f = (q && q.payload_json && q.payload_json.fields) || {}
  const d = [ft(f.bw), ft(f.bl), ft(f.bh)]
  if (d[0] && d[1]) return d.filter(Boolean).map((n) => `${n}′`).join(' \xD7 ')
  const m = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?/i.exec(str(q && q.building_size))
  return m ? [m[1], m[2], m[3]].filter(Boolean).map((n) => `${n}′`).join(' \xD7 ') : ''
}
const sqftOf = (q) => { const f = (q && q.payload_json && q.payload_json.fields) || {}; return (ft(f.bw) || 0) * (ft(f.bl) || 0) }
const CT_PAY = ['Credit Card', 'ACH / Wire Transfer', 'Check', 'Cash', 'Financing'] // the contract's #ct-pay options
export const PAY_METHODS = CT_PAY
const clientName = (c) => str(c && (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ')))
const clientAddr = (c) => {
  if (!c) return ''
  const line2 = [str(c.city), [str(c.state), str(c.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [str(c.address_line), line2].filter(Boolean).join('\n')
}

/** Everything the box and the document start with, from the quote the addition adds to + the lead. */
export function additionDefaults(q, client, { countyTax = null } = {}) {
  const f = (q && q.payload_json && q.payload_json.fields) || {}
  const mfr = MFR_KEY(q, client)
  const county = str(f.county) && str(f.county) !== '—' ? str(f.county) : str(client && client.county)
  const bill = str(f['ct-billaddr']) || clientAddr(client)
  const site = str(f['ct-siteaddr']) || bill
  const agx = str(f.agx) === 'yes'
  let taxPct = 6 // the program's default rate (COUNTY_TAX[cty] || 6)
  if (agx) taxPct = 0
  else if (countyTax && county && Number.isFinite(Number(countyTax[county]))) taxPct = Number(countyTax[county])
  else if (Number.isFinite(parseFloat(f.tax))) taxPct = parseFloat(f.tax)
  const fee = ADDITION_FEE[mfr] || ADDITION_FEE.CCI
  return {
    mfr,
    name: str(f.cn) || clientName(client),
    phone: str(f.cp) || str(client && client.phone),
    email: str(f.ce) || str(client && client.email),
    billAddr: bill,
    siteAddr: site,
    county,
    taxPct,
    agx,
    payMethod: CT_PAY.includes(str(f['ct-pay'])) ? str(f['ct-pay']) : CT_PAY[0],
    fee: fee.amount,
    feeNote: fee.note,
    root: additionRootOf(q),
    origSigned: signedOnOf(q),
    building: buildingSizeOf(q),
    sqft: sqftOf(q),
  }
}

// ── the record saved on the quote (payload_json.additions[]) ──────────────────────────────────────
/** What is saved for one addition order. */
export function additionRecord({ number, date, d, money, items, notes = '', payMethod = '', filePath = null, by = null, now = new Date() }) {
  return {
    number,
    date,
    mfr: d.mfr,
    county: d.county,
    items: items.map((it, i) => ({ kind: it.kind, type: it.type || null, qty: money.lines[i].qty, wall: it.wall || '', framed: !!(it.kind === 'wtd' && it.framed), desc: money.lines[i].desc, unit: money.lines[i].unit, amount: money.lines[i].amount })),
    sub: money.sub, taxPct: money.taxPct, tax: money.tax, fee: money.fee, total: money.total,
    depPct: money.depPct, deposit: money.deposit, waived: money.waived, balance: money.balance,
    payMethod: money.waived ? '' : payMethod,
    notes: str(notes),
    filePath,
    signed: null,
    by,
    createdAt: now.toISOString(),
  }
}
/** payload_json with `rec` added (or the addition with the same number replaced). */
export function withAddition(payload, rec) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const list = (Array.isArray(p.additions) ? p.additions : []).filter((a) => a && a.number !== rec.number)
  return { ...p, additions: [...list, rec] }
}
/** payload_json with addition `number` changed by `patch` (null = no such addition). */
export function patchAddition(payload, number, patch) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const list = Array.isArray(p.additions) ? p.additions : []
  if (!list.some((a) => a && a.number === number)) return null
  return { ...p, additions: list.map((a) => (a && a.number === number ? { ...a, ...patch } : a)) }
}
/** Read the row fresh, change it, write it (a builder save in between is not overwritten). */
export async function saveAdditionPayload(sb, quoteId, change) {
  const { data, error } = await sb.from('quotes').select('payload_json').eq('id', quoteId).single()
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const next = change(row && row.payload_json)
  if (!next) throw new Error('That addition order is not on this quote any more.')
  const { error: e2 } = await sb.from('quotes').update({ payload_json: next }).eq('id', quoteId)
  if (e2) throw e2
  return next
}
/** "Robert Andrews-StormSafe Steel ADDITION ORDER SS-2026-79957-A (11.19).pdf" */
export function additionFileName(name, number, day) {
  const [, m, dd] = str(day).split('-').map(Number)
  const md = m && dd ? ` (${m}.${dd})` : ''
  return `${str(name) || 'Customer'}-StormSafe Steel ADDITION ORDER ${number}${md}.pdf`
}
/** "1 walk-in door and 2 windows" - what the order adds, in words. */
export function addsInWords(lines) {
  const n = { wtd: 0, win: 0, other: 0 }
  for (const l of lines || []) n[l.kind] = (n[l.kind] || 0) + (l.qty || 1)
  const parts = []
  if (n.wtd) parts.push(plural(n.wtd, 'walk-in door', 'walk-in doors'))
  if (n.win) parts.push(plural(n.win, 'window', 'windows'))
  if (n.other) parts.push(plural(n.other, 'other item', 'other items'))
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || '')
}
