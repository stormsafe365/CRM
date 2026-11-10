// The Bill of Sale box from a signed contract needs no typing (owner 11/9/26, Laura Rincon SS-2026-01418).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receiptDefaults, contractPayMethod, RECEIPT_METHODS } from '../src/lib/receiptPrefill.js'
import { orderTotalOf } from '../src/lib/receiptHtml.js'
import { receiptFreightOf } from '../src/lib/cardFreight.js'

// Laura's signed agreement card as the CRM stores it (no total_amount on the card; the price saved with the quote)
const laura = {
  manufacturer: 'cci', status: 'deposit_paid', quote_number: 'SS-2026-01418', total_amount: null, deposit_amount: null,
  payload_json: {
    fields: { 'ct-pay': 'ACH / Wire Transfer', bw: '40' },
    priced: { sub: 64475, frt: 1934.25, money: { adjTot: 54056, dep: 7892, bal: 46164 } },
    executed: { at: '2026-11-07', signedOn: '2026-11-07', confirmed: true },
  },
}
test('from the signed contract: the contract payment method and the signed day', () => {
  assert.deepEqual(receiptDefaults(laura, { fromContract: true, today: '2026-11-09' }), { method: 'ACH / Wire Transfer', date: '2026-11-07' })
})
test('from a quote card: the contract payment method, today', () => {
  assert.deepEqual(receiptDefaults(laura, { today: '2026-11-09' }), { method: 'ACH / Wire Transfer', date: '2026-11-09' })
})
test('no contract method / not signed: the first method, today', () => {
  const q = { payload_json: { fields: {} } }
  assert.deepEqual(receiptDefaults(q, { fromContract: true, today: '2026-11-09' }), { method: RECEIPT_METHODS[0], date: '2026-11-09' })
  assert.equal(contractPayMethod({ payload_json: { fields: { 'ct-pay': 'Credit Card' } } }), 'Credit / Debit Card')
  assert.equal(contractPayMethod({ payload_json: { fields: { 'ct-pay': '' } } }), null)
})
test('every number the bill of sale needs comes from a contract card with no total_amount: total 54,056, deposit 7,892, freight 1,934.25 saved', () => {
  assert.equal(orderTotalOf(laura).total, 54056)
  assert.equal(Number(laura.payload_json.priced.money.dep), 7892)
  assert.deepEqual(receiptFreightOf(laura), { freight: 1934.25, source: 'saved' })
})
test('Laura\'s real card (saved before freight was its own charge - no priced.frt): freight = 3% of the saved price', () => {
  const real = { ...laura, payload_json: { ...laura.payload_json, priced: { sub: 64475, money: { adjTot: 54056, dep: 7892, bal: 46164 } } } }
  assert.deepEqual(receiptFreightOf(real), { freight: 1934.25, source: 'estimate', sub: 64475 })
})
test('priced since 11-03 with freight 0: none', () => {
  const z = { ...laura, payload_json: { ...laura.payload_json, priced: { sub: 40000, frt: 0, money: {} } } }
  assert.deepEqual(receiptFreightOf(z), { freight: 0, source: 'none' })
})
