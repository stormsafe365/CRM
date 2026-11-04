// cardFreight.js — the CCI freight lines on a quote card (owner 11/3/26: "Show building cost & under show with
// freight fee and then total cost").
//
// A quote's total_amount is the BUILDING total and never includes freight: since 11-03a the quote program charges CCI
// freight (3% of the building price before discounts on a CCI building of $60,000 or more, and on every CCI 61'-100'
// wide one) as its OWN charge — not discounted, not taxed, not in the deposit, due at installation — and saves the
// amount it charged in payload_json.priced.frt (PriceLock.snapshot). The card shows that saved amount; it never
// re-prices anything.
//
// A quote saved BEFORE freight was its own charge has no priced.frt. When it is opened, the program (11-03b,
// quote-builder.html `root._frtHold`) charges it today's freight unless it is sold (verbal accept / deposit paid /
// revised) or 61'-100' wide (its freight sits inside its saved building price). That amount comes from TODAY's price
// of the building, which the card cannot know, so the card says the freight is added when the quote is opened instead
// of guessing a number (saving it once stores the exact amount).
//
// Returns null (no freight: the card shows its Quote Total as before), or
//   { building, freight, total }   freight saved with the quote — exact
//   { building, pending: true }    freight will be added when the quote is opened

export const FREIGHT_AT = 60000            // quote-builder.html CCI_FREIGHT_AT
const SOLD = ['verbal_accept', 'deposit_paid', 'revised'] // quote-builder.html PL.SOLD
const c2 = (n) => Math.round(n * 100) / 100
const num = (v) => (v == null || v === '' ? NaN : Number(v))

// quote-builder.html cciWideOn: a CCI building 61'-100' wide
export function cciWide(width) {
  const w = parseInt(width, 10)
  return w >= 61 && w <= 100
}

export function cardFreightOf(q) {
  const building = num(q?.total_amount)
  if (!Number.isFinite(building)) return null
  const p = q.payload_json || {}
  const pr = p.priced || null
  const saved = pr ? num(pr.frt) : NaN
  if (Number.isFinite(saved)) return saved > 0 ? { building: c2(building), freight: c2(saved), total: c2(building + saved) } : null

  // no freight saved with it: what the program does when it is opened
  if (q.manufacturer !== 'cci') return null
  const wide = cciWide(p.fields && p.fields.bw)
  const frtSep = !!(p.overrides && p.overrides.frtSep)
  if (!frtSep && (wide || SOLD.includes(q.status))) return null
  const sub = pr ? num(pr.sub) : NaN
  if (wide || (Number.isFinite(sub) && sub >= FREIGHT_AT)) return { building: c2(building), pending: true }
  return null
}
