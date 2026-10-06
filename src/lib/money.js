// ONE rule for a dollar amount on screen (owner 10/6/26: a quote card showed
// "QUOTE TOTAL $33,521.5" / "Balance Due $28,170.5"):
//   - an amount with cents always shows both digits:  33521.5 -> $33,521.50
//   - a whole-dollar amount keeps the whole-dollar look: 5351  -> $5,351
// Rounded to the cent first (never to the dollar), so nothing is hidden.
// Documents that print cents on every line (receipt, revision order, the
// price-lock notes: priceLockCrm.fmtMoney) keep their fixed ".00" formatter.
// Compact abbreviations ($33.5K, $34k) in the pipeline / command center are
// not amounts and are not changed.
export function usd(n) {
  if (n == null || n === '') return null
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  const c = Math.round(v * 100)
  const a = Math.abs(c) / 100
  const s = c % 100 === 0
    ? a.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (c < 0 ? '−$' : '$') + s
}
