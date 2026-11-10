// Bill of Sale / Payment Receipt (lib/receiptHtml): the manufacturer is named only when the rep picks it (owner 11/9/26:
// "Its our bill of sale for the deposit, i dont think its necessary ... list manufacturer - yes/no").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReceiptHtml, makeReceiptNumber } from '../src/lib/receiptHtml.js'

const client = { name: 'Laura Rincon', email: 'l@example.com' }
const cci = { manufacturer: 'CCI', quote_number: 'SS-2026-93643', total_amount: 54056, building_size: "30' x 50' x 14'" }
const base = { number: 'BOS-2026-93643-20261109', date: '2026-11-09', amount: 7892, method: 'Credit / Debit Card', appliedTo: 'Deposit', remaining: 46164 }

test('CCI, default (listMfr not set): StormSafe bill of sale - no Carolina Carports anywhere', () => {
  const h = buildReceiptHtml({ client, quote: cci, receipt: { ...base } })
  assert.match(h, /Bill of Sale/)
  assert.doesNotMatch(h, /Carolina/)
  assert.doesNotMatch(h, /CCI\)/)
  assert.match(h, /<title>BOS-2026-93643-20261109 — StormSafe Steel<\/title>/)
  assert.match(h, /This bill of sale confirms receipt of the payment shown above toward\s+the building described\. Remaining balances/)
})
test('CCI, listMfr false: same as the default', () => {
  assert.equal(buildReceiptHtml({ client, quote: cci, receipt: { ...base, listMfr: false } }), buildReceiptHtml({ client, quote: cci, receipt: { ...base } }))
})
test('CCI, listMfr true: exactly as before 11/9/26 (seller, dealer, manufacturer line, CCI terms)', () => {
  const h = buildReceiptHtml({ client, quote: cci, receipt: { ...base, listMfr: true } })
  assert.match(h, /<span class="k">Seller<\/span><span class="v">Carolina Carports, Inc\.<\/span>/)
  assert.match(h, /<span class="k">Dealer<\/span><span class="v">StormSafe Steel<\/span>/)
  assert.match(h, /Manufacturer: Carolina Carports, Inc\. \(CCI\)/)
  assert.match(h, /Building manufactured &amp; sold by <b>Carolina Carports, Inc\.<\/b>/)
  assert.match(h, /manufactured and sold by Carolina Carports, Inc\./)
})
test('not CCI: a Payment Receipt, never a manufacturer (listMfr ignored)', () => {
  const ca = { ...cci, manufacturer: 'CA' }
  const h = buildReceiptHtml({ client, quote: ca, receipt: { ...base, listMfr: true } })
  assert.match(h, /Payment Receipt/)
  assert.doesNotMatch(h, /Carolina|Bill of Sale/)
  assert.match(makeReceiptNumber(ca), /^RCPT-/)
  assert.match(makeReceiptNumber(cci), /^BOS-/)
})

// Freight (owner 11/9/26, Laura Rincon: "What about the freight fee???"): CCI freight is its own charge, due at installation.
test('freight > 0: a Freight row and the Total Still Due under the remaining balance (Laura Rincon: 46,164 + 1,934.25)', () => {
  const h = buildReceiptHtml({ client, quote: cci, receipt: { ...base, freight: 1934.25 } })
  assert.match(h, /<tr class="rem"><td>Remaining Balance<\/td><td>\$46,164\.00<\/td><\/tr>/)
  assert.match(h, /<tr class="frt"><td>Freight &mdash; 3% \(not taxed, due at installation\)<\/td><td>\$1,934\.25<\/td><\/tr>/)
  assert.match(h, /<tr class="due"><td>Total Still Due \(incl\. freight\)<\/td><td>\$48,098\.25<\/td><\/tr>/)
})
test('no freight (0 / missing): no freight rows, as before', () => {
  for (const f of [0, undefined, '']) {
    const h = buildReceiptHtml({ client, quote: cci, receipt: { ...base, freight: f } })
    assert.doesNotMatch(h, /class="frt"|Total Still Due/)
  }
})
test('building paid in full but freight still due: not "PAID IN FULL"; the freight is what is left', () => {
  const h = buildReceiptHtml({ client, quote: cci, receipt: { ...base, amount: 54056, remaining: 0, appliedTo: 'Paid in Full', freight: 1934.25 } })
  assert.doesNotMatch(h, /PAID IN FULL/)
  assert.match(h, /Total Still Due \(incl\. freight\)<\/td><td>\$1,934\.25/)
})
