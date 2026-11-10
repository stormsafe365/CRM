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

// The freight for a Bill of Sale (owner 11/9/26, Laura Rincon: "What about the freight fee???" - her quote was saved before
// freight was its own charge, so it has no saved amount and its card shows none, while her contract charges it).
//   { freight, source: 'saved' }            the amount saved with the quote (exact - the card / contract number)
//   { freight, source: 'estimate', sub }    no amount saved: the quote program's own rule on the saved building price before
//                                           discounts (quote-builder.html cciFreightOn / freightP: CCI, $60,000+ -> 3%) -
//                                           Laura: 3% of $64,475 = $1,934.25 = her contract; the rep checks it
//   { freight: 0, source: 'none' }          nothing to go on (not CCI, under $60,000, or a 61'-100' wide one saved before
//                                           11-03, whose freight sits inside its building price)
export function receiptFreightOf(q) {
  // the saved amount straight from the quote - not via cardFreightOf, which needs the card's total_amount (a contract /
  // copy card can lack it, and its saved freight then read as none: found 11/10/26 with the Bill of Sale from a contract)
  const p = (q && q.payload_json) || {}
  const savedFrt = num(p.priced && p.priced.frt)
  if (Number.isFinite(savedFrt) && savedFrt > 0) return { freight: c2(savedFrt), source: 'saved' }
  if (!q || q.manufacturer !== 'cci') return { freight: 0, source: 'none' }
  const sub = num(p.priced && p.priced.sub)
  if (Number.isFinite(savedFrt)) return { freight: 0, source: 'none' } // priced since 11-03: it charged none
  if (cciWide(p.fields && p.fields.bw) && !(p.overrides && p.overrides.frtSep)) return { freight: 0, source: 'none' }
  if (Number.isFinite(sub) && sub >= FREIGHT_AT) return { freight: c2(Math.round(sub * 3) / 100), source: 'estimate', sub: c2(sub) }
  return { freight: 0, source: 'none' }
}
