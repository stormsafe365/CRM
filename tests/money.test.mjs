// Unit tests for the CRM's one on-screen money rule (src/lib/money.js).
// Run: npm test   (node --test, no dependencies)
//
// Owner 10/6/26: a quote card showed "QUOTE TOTAL $33,521.5" and
// "Balance Due $28,170.5" next to "Deposit $5,351".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usd } from '../src/lib/money.js'
import { quoteOptionLabel } from '../src/lib/layoutFromQuote.js'

test('cents always print two digits', () => {
  assert.equal(usd(33521.5), '$33,521.50')
  assert.equal(usd(28170.5), '$28,170.50')
  assert.equal(usd('33521.5'), '$33,521.50')
  assert.equal(usd(21962.63), '$21,962.63')
  assert.equal(usd(0.5), '$0.50')
  assert.equal(usd(1234.005), '$1,234.01') // rounded to the cent, never to the dollar
})

test('whole dollars keep the whole-dollar look', () => {
  assert.equal(usd(5351), '$5,351')
  assert.equal(usd(44448), '$44,448')
  assert.equal(usd('44448.00'), '$44,448')
  assert.equal(usd(0), '$0')
  assert.equal(usd(33521.999), '$33,522') // 0.999 rounds to a whole cent count
})

test('negative amounts', () => {
  assert.equal(usd(-150.5), '−$150.50')
  assert.equal(usd(-4340), '−$4,340')
})

test('empty / not a number -> null (each screen keeps its own placeholder)', () => {
  assert.equal(usd(null), null)
  assert.equal(usd(undefined), null)
  assert.equal(usd(''), null)
  assert.equal(usd('abc'), null)
  assert.equal(usd(Infinity), null)
})

test('the layout quote picker uses the same rule', () => {
  assert.equal(quoteOptionLabel({ quote_number: 'SS-2026-00144', quote_date: '2026-10-06', total_amount: 33521.5 }), 'Quote #SS-2026-00144 — 10/06/2026 — $33,521.50')
  assert.equal(quoteOptionLabel({ quote_number: 'SS-2026-00144', quote_date: '2026-10-06', total_amount: 5351 }), 'Quote #SS-2026-00144 — 10/06/2026 — $5,351')
})
