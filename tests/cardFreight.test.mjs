// Unit tests for the quote card's freight lines (src/lib/cardFreight.js).
// Run: npm test   (node --test, no dependencies)
//
// Owner 11/3/26: "Show building cost & under show with freight fee and then total cost".
// The rules mirror the quote program's freight hold (quote-builder.html root._frtHold, 11-03b).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardFreightOf, cciWide } from '../src/lib/cardFreight.js'

const q = (o = {}) => ({ manufacturer: 'cci', status: 'sent', total_amount: 54056, payload_json: { fields: { bw: '40' }, ...(o.payload || {}) }, ...o.row })

test('freight saved with the quote: building, freight, total to the cent', () => {
  // Laura Rincon 40x60x20: $54,056 + freight $1,934.25 = $55,990.25
  const r = cardFreightOf(q({ payload: { priced: { frt: 1934.25, sub: 64475 } } }))
  assert.deepEqual(r, { building: 54056, freight: 1934.25, total: 55990.25 })
})

test('saved freight of 0 (or a CA quote) shows no freight lines', () => {
  assert.equal(cardFreightOf(q({ payload: { priced: { frt: 0, sub: 30000 } } })), null)
  assert.equal(cardFreightOf(q({ row: { manufacturer: 'ca' }, payload: { priced: { sub: 90000 } } })), null)
})

test('the saved amount wins even on a sold quote', () => {
  const r = cardFreightOf(q({ row: { status: 'deposit_paid' }, payload: { priced: { frt: 1956.6, sub: 65220 } } }))
  assert.equal(r.total, 54056 + 1956.6)
})

test('an older save (no freight saved), unsigned, $60k+: freight is added when opened - no guessed number', () => {
  const r = cardFreightOf(q({ payload: { priced: { sub: 65220 } } }))
  assert.deepEqual(r, { building: 54056, pending: true })
  assert.equal(cardFreightOf(q({ payload: { priced: { sub: 59999 } } })), null)
  assert.deepEqual(cardFreightOf(q({ payload: { priced: { sub: 60000 } } })), { building: 54056, pending: true })
})

test('an older save that is sold, or 61-100 wide, keeps no freight (as the program)', () => {
  for (const status of ['verbal_accept', 'deposit_paid', 'revised']) {
    assert.equal(cardFreightOf(q({ row: { status }, payload: { priced: { sub: 80000 } } })), null, status)
  }
  assert.equal(cardFreightOf(q({ payload: { fields: { bw: '64' }, priced: { sub: 150000 } } })), null)
})

test('a save by the freight program without an amount (frtSep): today\'s rule, even sold or wide', () => {
  const ov = { overrides: { frtSep: 1 } }
  assert.deepEqual(cardFreightOf(q({ row: { status: 'revised' }, payload: { ...ov, priced: { sub: 70000 } } })), { building: 54056, pending: true })
  assert.deepEqual(cardFreightOf(q({ payload: { ...ov, fields: { bw: '70' }, priced: { sub: 40000 } } })), { building: 54056, pending: true })
  assert.equal(cardFreightOf(q({ payload: { ...ov, priced: { sub: 40000 } } })), null)
})

test('no total or no price snapshot: no freight lines', () => {
  assert.equal(cardFreightOf(q({ row: { total_amount: null }, payload: { priced: { frt: 100 } } })), null)
  assert.equal(cardFreightOf(q()), null)
  assert.equal(cardFreightOf(null), null)
})

test('wide = 61 to 100 feet', () => {
  assert.equal(cciWide('60'), false)
  assert.equal(cciWide('61'), true)
  assert.equal(cciWide(100), true)
  assert.equal(cciWide('101'), false)
  assert.equal(cciWide(''), false)
})
