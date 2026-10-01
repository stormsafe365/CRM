// Unit tests for the CRM side of the reopened-quote price lock
// (src/lib/priceLockCrm.js). Run: npm test   (node --test, no dependencies)
//
// Graham's quote #SS-2026-05670 is the owner's case: saved/accepted 9/17 at
// $44,448.00 / $5,222.00 / $39,226.00; reopening with today's rules gave
// $43,545.00 (the 9/18 side-frame rule, d4c8695).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import {
  SOLD_STATUSES, appendPriceHistory, autoDocGate, fmtDelta, fmtMoney, guardBuilderUpdate, HISTORY_MAX,
  HISTORY_PAYLOAD_KEEP, honoredLegacyOrder, isBuilderPayload, lockBanner, lockTarget, mergeSaved, planQuoteFields,
  printedBuildingAmount, readLockState, readScreenTotals, restoreOptionsFor, revisionOriginal, revisionReconcile,
  savedTotalsOf, stripForDuplicate, totalsDiffer, withPrintCheck, writeCheck,
} from '../src/lib/priceLockCrm.js'

const here = dirname(fileURLToPath(import.meta.url))

const GRAHAM_SAVED = { total: 44448, deposit: 5222, balance: 39226 }
const GRAHAM_TODAY = { total: 43545, deposit: 5116, balance: 38429 }
const grahamRow = (over = {}) => ({
  id: 'q-graham', client_id: 'c-graham', quote_number: 'SS-2026-05670', quote_date: '2026-09-17',
  status: 'deposit_paid', total_amount: '44448.00', deposit_amount: '5222.00', balance_amount: '39226.00',
  valid_through: '2026-10-17', notes: 'Customer wants delivery after 11/1', pdf_snapshot_url: 'c-graham/quote/1758000000000-SS-2026-05670.pdf',
  created_at: '2026-09-17T14:02:00Z', updated_at: '2026-09-17T15:40:00Z',
  payload_json: {
    version: 2, savedAt: '2026-09-17T15:39:00Z', mfr: 'CCI', source: '3d-builder',
    fields: { bw: '40', bl: '60', bh: '20', county: 'Manatee', disc: '20', agx: 'yes', 'add-disc': '35', 'add-disc-type': 'pct' },
    totals: { total: 44448, deposit: 5222, balance: 39226 }, rendering_thumb: 'data:image/jpeg;base64,AAAA', card: { roofColor: 'Barn Red' },
  },
  ...over,
})
// What window.PriceLock.state() reports for Graham reopened with the lock (builder e32bf5b).
const grahamLock = (over = {}) => ({
  requested: true, ready: true, active: true, ok: true, choice: 'keep', source: 'legacy', status: 'deposit_paid', sold: true,
  saved: { ...GRAHAM_SAVED }, current: { ...GRAHAM_SAVED }, today: { ...GRAHAM_TODAY }, hold: 1200,
  parts: [{ k: 'sideFrames', label: 'Side frames (as originally quoted)', amt: 1200, rules: ['side-frames'] }],
  rules: [], issues: [], notes: [], compliance: [], differsFromSaved: false, canAutoDoc: true,
  ...over,
})

// ── money ──
test('money formatting and cent comparison', () => {
  assert.equal(fmtMoney(44448), '$44,448.00')
  assert.equal(fmtMoney(-903), '−$903.00')
  assert.equal(fmtDelta(43545 - 44448), '−$903.00')
  assert.equal(fmtDelta(1200), '+$1,200.00')
  assert.equal(fmtDelta(0.001), '$0.00')
  assert.deepEqual(savedTotalsOf(grahamRow()), GRAHAM_SAVED)
  assert.equal(savedTotalsOf({ total_amount: null }), null)
  assert.equal(savedTotalsOf(null), null)
  assert.equal(totalsDiffer(GRAHAM_SAVED, { total: 44448.004, deposit: 5222, balance: 39226 }), false)
  assert.equal(totalsDiffer(GRAHAM_SAVED, { ...GRAHAM_SAVED, deposit: 5222.01 }), true)
  assert.equal(totalsDiffer(GRAHAM_SAVED, GRAHAM_TODAY), true)
  assert.equal(totalsDiffer(null, null), false)
  assert.equal(totalsDiffer(GRAHAM_SAVED, null), true)
})

// ── reopen options ──
test('restoreOptionsFor: legacy quote reopens locked with its card totals', () => {
  assert.deepEqual(restoreOptionsFor(grahamRow()), { lock: true, status: 'deposit_paid', legacyTotals: GRAHAM_SAVED })
})
test('restoreOptionsFor: v3 quote with a price snapshot reopens locked without legacy totals', () => {
  const q = grahamRow({ status: 'sent', payload_json: { ...grahamRow().payload_json, version: 3, priced: { v: 1, sub: 59075 } } })
  assert.deepEqual(restoreOptionsFor(q), { lock: true, status: 'sent' })
})
test('restoreOptionsFor: nothing to hold → today\'s pricing (null)', () => {
  assert.equal(restoreOptionsFor(grahamRow({ total_amount: null })), null)
  assert.equal(restoreOptionsFor(grahamRow({ payload_json: { ...grahamRow().payload_json, priceFresh: true } })), null)
  assert.equal(restoreOptionsFor({ payload_json: { source: '3d-builder' } }), null)
  assert.equal(restoreOptionsFor(null), null)
  assert.equal(isBuilderPayload({ source: '3d-builder' }), true)
  assert.equal(isBuilderPayload({}), false)
})

// ── automatic documents ──
test('autoDocGate: Graham held to the cent → contract / executed copy / revision may run', () => {
  const g = autoDocGate({ saved: GRAHAM_SAVED, screen: { ...GRAHAM_SAVED }, lock: grahamLock() })
  assert.deepEqual(g, { ok: true })
})
test('autoDocGate: builder without the lock that reprices → blocked with saved vs today', () => {
  const g = autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: null })
  assert.equal(g.ok, false)
  assert.ok(!g.wait)
  assert.match(g.reason, /\$44,448\.00/)
  assert.match(g.reason, /\$43,545\.00/)
  assert.match(g.reason, /−\$903\.00/)
})
test('autoDocGate: lock not requested (kill switch) but same totals → ok', () => {
  assert.equal(autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: { requested: false, ready: true } }).ok, true)
})
test('autoDocGate: waits, then blocks on issues / today / drift / open compliance', () => {
  assert.equal(autoDocGate({ saved: GRAHAM_SAVED, screen: null, lock: grahamLock() }).wait, true)
  assert.equal(autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock({ ready: false }) }).wait, true)
  const iss = autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock({ issues: ['Roll-up door 1 rsz: saved "10x10", now ""'], canAutoDoc: false }) })
  assert.equal(iss.ok, false); assert.match(iss.reason, /Roll-up door 1/)
  const nok = autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: grahamLock({ ok: false }) })
  assert.equal(nok.ok, false); assert.match(nok.reason, /could not be held/)
  const today = autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: grahamLock({ choice: 'today', active: false }) })
  assert.equal(today.ok, false); assert.match(today.reason, /Today's pricing/)
  const edited = autoDocGate({ saved: GRAHAM_SAVED, screen: { total: 46548, deposit: 5579, balance: 40969 }, lock: grahamLock() })
  assert.equal(edited.ok, false); assert.match(edited.reason, /\+\$2,100\.00/)
  const comp = autoDocGate({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock({ compliance: [{ id: 'hw-12ga' }], canAutoDoc: false }) })
  assert.equal(comp.ok, false); assert.match(comp.reason, /1 rule decision needed/)
  assert.equal(autoDocGate({ saved: null, screen: GRAHAM_TODAY, lock: null }).ok, true) // nothing saved to protect
})

// Honor Signed Pricing on a sold order (verifier V22): the builder holds the
// signed contract's $16,052 while the card says $16,558.
const HONOR_CARD = { total: 16558, deposit: 2643, balance: 13915 }
const HONOR_SIGNED = { total: 16052, deposit: 2562, balance: 13490 }
const honorLock = (over = {}) => grahamLock({ source: 'legacy+honor', saved: { ...HONOR_SIGNED }, current: { ...HONOR_SIGNED }, today: { ...HONOR_CARD }, hold: -470, parts: [], ...over })
test('autoDocGate: honored sold order is held to the SIGNED price, not the card', () => {
  assert.deepEqual(autoDocGate({ saved: HONOR_CARD, screen: { ...HONOR_SIGNED }, lock: honorLock() }), { ok: true })
  const moved = autoDocGate({ saved: HONOR_CARD, screen: HONOR_CARD, lock: honorLock() })
  assert.equal(moved.ok, false); assert.match(moved.reason, /\$16,052\.00/)
  // Today's pricing chosen: back to the card as the reference.
  assert.equal(autoDocGate({ saved: HONOR_CARD, screen: HONOR_SIGNED, lock: honorLock({ choice: 'today' }) }).ok, false)
})
test('lockBanner / writeCheck: honored sold order names the signed price and the card', () => {
  const b = lockBanner({ saved: HONOR_CARD, screen: HONOR_SIGNED, lock: honorLock() })
  assert.equal(b.tone, 'warn')
  assert.match(b.text, /Saved price held: \$16,052\.00 \(signed contract; the card shows \$16,558\.00\)/)
  const c = writeCheck({ kind: 'save', saved: HONOR_CARD, next: HONOR_SIGNED, lock: honorLock(), status: 'deposit_paid' })
  assert.equal(c.confirm, true)
  assert.equal(c.title, 'Save quote at the signed-contract price?')
  assert.equal(writeCheck({ kind: 'contract', saved: HONOR_CARD, next: HONOR_SIGNED, lock: honorLock() }).title, 'Generate contract at the signed-contract price?')
  assert.deepEqual(c.lines.map((l) => [l.from, l.to]), [[16558, 16052], [2643, 2562], [13915, 13490]])
  assert.ok(c.notes.some((n) => /Honor Signed Pricing: the builder holds the signed contract's \$16,052\.00 — the card showed \$16,558\.00/.test(n)))
  assert.ok(!c.notes.some((n) => /re-sign/.test(n))) // the customer already signed $16,052
  // Finish Revision starts from the signed contract (the Revision Order's and Revised Contract's original)
  const REV = { total: 16506, deposit: 2635, balance: 13871 }
  const rv = writeCheck({ kind: 'revision', saved: HONOR_CARD, next: REV, lock: honorLock({ current: REV }), status: 'deposit_paid' })
  assert.deepEqual(rv.lines.map((l) => [l.from, l.to, l.delta]), [[16052, 16506, 454], [2562, 2635, 73], [13490, 13871, 381]])
  assert.ok(rv.notes.some((n) => /Original contract: the signed \$16,052\.00 \(Honor Signed Pricing; the card showed \$16,558\.00\)/.test(n)))
  // a non-honored revision is unchanged: from the card
  const g = writeCheck({ kind: 'revision', saved: GRAHAM_SAVED, next: { total: 44749, deposit: 5258, balance: 39491 }, lock: grahamLock() })
  assert.deepEqual(g.lines.map((l) => l.from), [44448, 5222, 39226])
  assert.ok(!g.notes.some((n) => /Original contract/.test(n)))
})

// ── confirm before a write ──
test('writeCheck: every write to a saved quote asks — untouched says "no price change"', () => {
  const c = writeCheck({ kind: 'save', saved: GRAHAM_SAVED, next: { ...GRAHAM_SAVED }, lock: grahamLock(), status: 'deposit_paid' })
  assert.equal(c.confirm, true)
  assert.equal(c.changed, false)
  assert.equal(c.title, 'Save quote?')
  assert.deepEqual(c.lines.map((l) => [l.label, l.from, l.to, l.delta]), [
    ['Total', 44448, 44448, 0], ['Deposit', 5222, 5222, 0], ['Balance', 39226, 39226, 0],
  ])
  assert.ok(c.notes.some((n) => /No price change: the saved \$44,448\.00 is kept\./.test(n)))
  assert.ok(!c.notes.some((n) => /re-sign/.test(n)))
  const k = writeCheck({ kind: 'contract', saved: GRAHAM_SAVED, next: GRAHAM_SAVED, lock: grahamLock() })
  assert.equal(k.confirm, true); assert.equal(k.title, 'Generate contract?')
  const e = writeCheck({ kind: 'exec', saved: GRAHAM_SAVED, next: GRAHAM_SAVED, lock: grahamLock() })
  assert.equal(e.confirm, true); assert.equal(e.title, 'Generate executed copy?')
})
test('writeCheck: a different price always asks, showing saved → new', () => {
  const c = writeCheck({ kind: 'save', saved: GRAHAM_SAVED, next: GRAHAM_TODAY, lock: null, status: 'deposit_paid' })
  assert.equal(c.confirm, true)
  assert.equal(c.title, 'Save this quote at a new price?')
  assert.deepEqual(c.lines.map((l) => [l.label, l.from, l.to, l.delta]), [
    ['Total', 44448, 43545, -903], ['Deposit', 5222, 5116, -106], ['Balance', 39226, 38429, -797],
  ])
  assert.ok(c.notes.some((n) => /repriced the quote with today's rules/.test(n)))
  assert.ok(c.notes.some((n) => /customer must re-sign/.test(n)))
  assert.ok(c.notes.some((n) => /history/.test(n)))
})
test('writeCheck: today\'s pricing chosen, lock failure, revision and forced runs ask', () => {
  const t = writeCheck({ kind: 'contract', saved: GRAHAM_SAVED, next: GRAHAM_TODAY, lock: grahamLock({ choice: 'today' }), status: 'sent' })
  assert.equal(t.confirm, true); assert.ok(t.notes.some((n) => /Update to today's pricing/.test(n)))
  assert.ok(!t.notes.some((n) => /re-sign/.test(n))) // 'sent' is not sold
  const f = writeCheck({ kind: 'exec', saved: GRAHAM_SAVED, next: GRAHAM_SAVED, lock: grahamLock({ ok: false, issues: ['x'] }) })
  assert.equal(f.confirm, true); assert.equal(f.title, 'Generate executed copy?')
  const r = writeCheck({ kind: 'revision', saved: GRAHAM_SAVED, next: GRAHAM_SAVED, lock: grahamLock() })
  assert.equal(r.confirm, true); assert.equal(r.lines[0].label, 'Contract total')
  const b = writeCheck({ kind: 'apply', saved: GRAHAM_SAVED, next: GRAHAM_SAVED, lock: grahamLock(), force: true, reason: 'Waiting.' })
  assert.equal(b.confirm, true); assert.equal(b.notes[0], 'Waiting.')
  assert.equal(writeCheck({ kind: 'save', saved: null, next: GRAHAM_TODAY, lock: null }).confirm, false) // brand-new quote
})

// ── re-save: status / validity / notes ──
test('planQuoteFields: new quote → draft, 30 days, no notes', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  assert.deepEqual(planQuoteFields({ initialQuote: null, totals: GRAHAM_SAVED, now }), { status: 'draft', valid_through: '2026-10-30', notes: null })
})
test('planQuoteFields: sold orders keep status, validity and notes — even at a new price', () => {
  for (const s of SOLD_STATUSES) {
    assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: s }), totals: GRAHAM_SAVED }), {})
    assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: s }), totals: GRAHAM_TODAY }), {})
  }
})
test('planQuoteFields: unsold quotes go back to draft only when the price changes', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'sent' }), totals: GRAHAM_TODAY, now }), { status: 'draft', valid_through: '2026-10-30' })
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'sent' }), totals: GRAHAM_SAVED, now }), { valid_through: '2026-10-30' })
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'draft' }), totals: GRAHAM_SAVED, now }), { valid_through: '2026-10-30' })
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'expired' }), totals: GRAHAM_SAVED, now }), {})
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'expired' }), totals: GRAHAM_TODAY, now }), { status: 'draft', valid_through: '2026-10-30' })
  assert.deepEqual(planQuoteFields({ initialQuote: grahamRow({ status: 'declined', total_amount: null }), totals: GRAHAM_SAVED, now }), { status: 'draft', valid_through: '2026-10-30' })
})
test('guardBuilderUpdate: never overwrites a sold status or the notes', () => {
  assert.deepEqual(guardBuilderUpdate(grahamRow(), { status: 'draft', notes: null, total_amount: 1 }), { total_amount: 1 })
  assert.deepEqual(guardBuilderUpdate(grahamRow({ status: 'sent' }), { status: 'draft', notes: null }), { status: 'draft' })
  assert.deepEqual(guardBuilderUpdate(grahamRow({ status: 'sent' }), { notes: 'keep me' }), { notes: 'keep me' })
})
test('mergeSaved: the modal\'s saved row follows each save (status kept when not sent)', () => {
  const now = new Date('2026-09-30T13:00:00Z')
  const m = mergeSaved(grahamRow(), { quote_number: 'X', quote_date: '2020-01-01', total_amount: 46548, status: undefined, pdf_snapshot_url: 'new.pdf' }, now)
  assert.equal(m.quote_number, 'SS-2026-05670')
  assert.equal(m.quote_date, '2026-09-17')
  assert.equal(m.status, 'deposit_paid')
  assert.equal(m.total_amount, 46548)
  assert.equal(m.pdf_snapshot_url, 'new.pdf')
  assert.equal(m.updated_at, now.toISOString())
  assert.equal(mergeSaved(null, {}), null)
})

// ── price history ──
test('appendPriceHistory: records the replaced version (totals, PDF, config) and carries old entries forward', () => {
  const now = new Date('2026-09-30T13:00:00Z')
  const h = appendPriceHistory({ initialQuote: grahamRow(), reason: 'update', next: GRAHAM_TODAY, now })
  assert.equal(h.length, 1)
  const e = h[0]
  assert.equal(e.at, '2026-09-17T15:40:00Z')
  assert.equal(e.replaced_at, now.toISOString())
  assert.deepEqual([e.total, e.deposit, e.balance], [44448, 5222, 39226])
  assert.deepEqual([e.new_total, e.new_deposit, e.new_balance], [43545, 5116, 38429])
  assert.equal(e.changed, true)
  assert.equal(e.status, 'deposit_paid')
  assert.equal(e.pdf, 'c-graham/quote/1758000000000-SS-2026-05670.pdf')
  assert.equal(e.payload.fields.county, 'Manatee')
  assert.equal(e.payload.rendering_thumb, undefined) // picture not duplicated into history
  // next save carries it forward
  const q2 = grahamRow({ updated_at: '2026-09-30T13:00:00Z', payload_json: { ...grahamRow().payload_json, price_history: h } })
  const h2 = appendPriceHistory({ initialQuote: q2, reason: 'revision', next: GRAHAM_SAVED, now })
  assert.equal(h2.length, 2)
  assert.equal(h2[0].pdf, e.pdf)
  assert.equal(h2[1].reason, 'revision')
  assert.equal(h2[1].changed, false)
  assert.equal(h2[1].payload.price_history, undefined) // no nesting
})
test('appendPriceHistory: only the newest few keep a config copy; capped length; nothing for an unsaved copy', () => {
  let q = grahamRow()
  for (let i = 0; i < HISTORY_MAX + 7; i++) {
    const h = appendPriceHistory({ initialQuote: q, next: GRAHAM_SAVED })
    q = grahamRow({ payload_json: { ...grahamRow().payload_json, price_history: h } })
  }
  const h = q.payload_json.price_history
  assert.equal(h.length, HISTORY_MAX)
  assert.equal(h.filter((e) => 'payload' in e).length, HISTORY_PAYLOAD_KEEP)
  assert.ok('payload' in h[h.length - 1])
  assert.ok(!('payload' in h[0]))
  assert.deepEqual(appendPriceHistory({ initialQuote: grahamRow({ total_amount: null, pdf_snapshot_url: null, payload_json: { fields: {} } }), next: GRAHAM_SAVED }), [])
  assert.deepEqual(appendPriceHistory({ initialQuote: null, next: GRAHAM_SAVED }), [])
})

// ── duplicate ──
test('stripForDuplicate: the copy carries the build but none of the held price', () => {
  const src = {
    ...grahamRow().payload_json, version: 3,
    fields: { ...grahamRow().payload_json.fields, 'hold-amt': '1200', 'hold-ref': '{"parts":[]}', 'hold-src': 'legacy|2026-09-30', 'hold-dec': '[]' },
    priced: { v: 1, sub: 59075 }, overrides: { fu14: true }, price_history: [{ total: 1 }], sessionEdits: [{ kind: 'misc', key: '_depPct', val: 20 }], inputMode: false,
  }
  const before = JSON.stringify(src)
  const now = new Date('2026-09-30T14:00:00Z')
  const d = stripForDuplicate(src, { fromQuote: { id: 'q-graham', quote_number: 'SS-2026-05670' }, newNumber: 'SS-2026-12345', now })
  assert.equal(JSON.stringify(src), before) // original untouched
  for (const k of ['priced', 'overrides', 'price_history', 'totals', 'sessionEdits', 'freshBasis']) assert.equal(k in d, false, k)
  for (const k of ['hold-amt', 'hold-ref', 'hold-src', 'hold-dec']) assert.equal(k in d.fields, false, k)
  assert.equal(d.fields.county, 'Manatee')
  assert.equal(d.fields.disc, '20') // the rep's terms (discount / additional discount) stay
  assert.equal(d.fields['add-disc'], '35')
  assert.equal(d.priceFresh, true)
  assert.equal(d.quote_number, 'SS-2026-12345')
  assert.deepEqual(d.duplicatedFrom, { id: 'q-graham', quote_number: 'SS-2026-05670', at: now.toISOString() })
  assert.equal(d.rendering_thumb, src.rendering_thumb)
  // …and it reopens at today's pricing
  assert.equal(restoreOptionsFor({ status: 'draft', total_amount: null, payload_json: d }), null)
})
test('stripForDuplicate: no as-sold state reaches the copy (price edits, honor, free 26GA)', () => {
  const src = {
    ...grahamRow().payload_json, version: 3,
    fields: { ...grahamRow().payload_json.fields, 'ct-honor': '13173', 'ct-honor-ref': 'SS-2026-80021', 'sheeting-upgrade': 'upgrade', 'ct-siteaddr': '12 Oak Ln', 'adj-amt': '250' },
    priced: { v: 1, sub: 12000, free: { sheet: true, fastener: true } },
    sessionEdits: [{ kind: 'door', tbl: 'door-std', k: '10x10', val: 1500 }, { kind: 'misc', key: 'dep-pct', val: 25 }],
    inputMode: true,
  }
  const d = stripForDuplicate(src, { fromQuote: grahamRow(), newNumber: 'SS-2026-22222' })
  assert.equal('sessionEdits' in d, false)
  assert.equal('ct-honor' in d.fields, false)
  assert.equal('ct-honor-ref' in d.fields, false)
  assert.equal(d.fields['sheeting-upgrade'], 'standard') // the free auto-upgrade was not a rep pick
  assert.equal(d.fields['ct-siteaddr'], '12 Oak Ln')       // contract addresses are not pricing
  assert.equal(d.fields['adj-amt'], '250')                 // rep terms stay (disclosed)
  assert.equal(d.inputMode, true)                          // a manual quote stays manual (disclosed)
  assert.equal('freshBasis' in d, false)                   // v3: everything needed is in the payload
  // a rep-paid 26GA (not free at sale) stays
  const paid = stripForDuplicate({ ...src, priced: { v: 1, sub: 9000, free: { sheet: false, fastener: false } } }, {})
  assert.equal(paid.fields['sheeting-upgrade'], 'upgrade')
})
test('stripForDuplicate + restoreOptionsFor: a copy of an OLDER quote opens fresh off the original card totals', () => {
  const d = stripForDuplicate(grahamRow().payload_json, { fromQuote: grahamRow(), newNumber: 'SS-2026-33333' })
  assert.deepEqual(d.freshBasis, GRAHAM_SAVED)
  assert.equal('totals' in d, false)
  const copy = { status: 'draft', total_amount: null, deposit_amount: null, balance_amount: null, payload_json: d }
  assert.deepEqual(restoreOptionsFor(copy), { lock: true, fresh: true, status: 'draft', legacyTotals: GRAHAM_SAVED })
  // a copy of that unsaved copy passes the basis on; a copy of a quote with no total has none
  const d2 = stripForDuplicate(d, { fromQuote: copy })
  assert.deepEqual(d2.freshBasis, GRAHAM_SAVED)
  assert.equal('freshBasis' in stripForDuplicate(grahamRow().payload_json, { fromQuote: grahamRow({ total_amount: null }) }), false)
  // a bad basis never asks for a lock
  assert.equal(restoreOptionsFor({ status: 'draft', payload_json: { ...d, freshBasis: { total: 0 } } }), null)
  assert.equal(restoreOptionsFor({ status: 'draft', payload_json: { ...d, freshBasis: { total: 'x' } } }), null)
})
test('revisionOriginal: the Revision Order uses the Revised Contract\'s original (honored signed price)', () => {
  const pgWith = (b) => ({ PriceLock: { rvBaseline: () => b } })
  // honored sold order: builder baseline = signed contract, card differs
  assert.deepEqual(revisionOriginal({ pg: pgWith(HONOR_SIGNED), typed: HONOR_CARD.total, card: HONOR_CARD }),
    { total: HONOR_SIGNED.total, deposit: HONOR_SIGNED.deposit, from: 'builder' })
  // no baseline (kill switch, old builder, unsold at today's pricing): the form / card, as before
  assert.deepEqual(revisionOriginal({ pg: pgWith(null), typed: '13600', card: HONOR_CARD }), { total: 13600, deposit: HONOR_CARD.deposit, from: 'modal' })
  assert.deepEqual(revisionOriginal({ pg: {}, typed: 0, card: { total: '44448.00', deposit: '5222.00' } }), { total: 44448, deposit: 5222, from: 'modal' })
  assert.deepEqual(revisionOriginal({ pg: { PriceLock: { rvBaseline: () => { throw new Error('x') } } }, typed: 0, card: GRAHAM_SAVED }), { total: 44448, deposit: 5222, from: 'modal' })
})
test('honoredLegacyOrder: sold + Honor Signed Pricing + saved before price snapshots', () => {
  const row = (over = {}, fields = {}) => grahamRow({ ...over, payload_json: { ...grahamRow().payload_json, fields: { ...grahamRow().payload_json.fields, ...fields } } })
  assert.equal(honoredLegacyOrder(row({}, { 'ct-honor': '13173' })), true)
  assert.equal(honoredLegacyOrder(row({ status: 'sent' }, { 'ct-honor': '13173' })), false)
  assert.equal(honoredLegacyOrder(row({}, { 'ct-honor': '' })), false)
  assert.equal(honoredLegacyOrder(grahamRow({ payload_json: { ...grahamRow().payload_json, priced: { v: 1 }, fields: { 'ct-honor': '1' } } })), false)
  assert.equal(honoredLegacyOrder(null), false)
})

// ── revision order ──
test('revisionReconcile: extra row makes the change rows add up to the build\'s net change', () => {
  // $1,900 list door, 20% discount + 7% tax → +$1,626.40 on the contract
  assert.equal(revisionReconcile([{ amount: '1900' }], 1626.4), -273.6)
  assert.equal(revisionReconcile([{ amount: '' }, { amount: '0' }], 0), 0)
  assert.equal(revisionReconcile([{ amount: '500' }, { amount: '-200' }], 300), 0)
  assert.equal(revisionReconcile([{ amount: '' }], 2100), 2100)
  assert.equal(revisionReconcile([], 0.001), 0)
})

// ── bar ──
test('lockBanner: Graham held → amber saved vs today; edits, failures and today\'s pricing are called out', () => {
  const held = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock() })
  assert.equal(held.tone, 'warn')
  assert.equal(held.text, "Saved price held: $44,448.00 · today's rules would be $43,545.00 (−$903.00) · nothing saved")
  const same = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock({ today: { ...GRAHAM_SAVED } }) })
  assert.deepEqual(same, { tone: 'ok', text: 'Saved price held: $44,448.00' })
  const noLock = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: null })
  assert.equal(noLock.text, "Saved $44,448.00 · today's rules $43,545.00 (−$903.00) · nothing saved")
  const fail = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: grahamLock({ ok: false, issues: ['Held totals do not match'] }) })
  assert.equal(fail.tone, 'error'); assert.equal(fail.detail, 'Held totals do not match')
  assert.match(fail.text, /could not be held exactly/)
  // held to the cent, but the reopen flagged something: never "could not be held"
  const flagged = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_SAVED, lock: grahamLock({ issues: ['Roll-up door 1 rsz: saved "10x10", now ""'], canAutoDoc: false }) })
  assert.equal(flagged.tone, 'error'); assert.equal(flagged.detail, 'Roll-up door 1 rsz: saved "10x10", now ""')
  assert.equal(flagged.text, 'Saved price held: $44,448.00 · check before sending documents (automatic contract paused) · nothing saved')
  assert.doesNotMatch(flagged.text, /could not be held/)
  const flaggedEdit = lockBanner({ saved: GRAHAM_SAVED, screen: { total: 46548, deposit: 5579, balance: 40969 }, lock: grahamLock({ issues: ['x'] }) })
  assert.match(flaggedEdit.text, /^Saved \$44,448\.00 → now \$46,548\.00 \(\+\$2,100\.00\) · check before sending documents/)
  const today = lockBanner({ saved: GRAHAM_SAVED, screen: GRAHAM_TODAY, lock: grahamLock({ choice: 'today' }) })
  assert.match(today.text, /^Today's pricing applied: saved \$44,448\.00 → \$43,545\.00 \(−\$903\.00\)/)
  assert.match(today.text, /customer must re-sign/)
  const edit = lockBanner({ saved: GRAHAM_SAVED, screen: { total: 46548, deposit: 5579, balance: 40969 }, lock: grahamLock({ compliance: [{ id: 'impact' }, { id: 'hw-12ga' }] }) })
  assert.match(edit.text, /→ now \$46,548\.00 \(\+\$2,100\.00\) · your changes are not saved yet · Sold order: 2 rule decisions needed/)
  assert.equal(lockBanner({ saved: null, screen: GRAHAM_TODAY, lock: null }), null)
  // edit saved during the session (card now $44,749): no stale today's-rules figure
  const after = { total: 44749, deposit: 5258, balance: 39491 }
  assert.deepEqual(lockBanner({ saved: after, screen: after, lock: grahamLock() }),
    { tone: 'ok', text: 'Saved $44,749.00 · includes changes since reopening (+$301.00 on the original $44,448.00)' })
})

// ── reading the program window ──
test('readScreenTotals / readLockState never throw', () => {
  const cells = { ptot: '$44,448.00', pdep: '$5,222.00', pbal: '$39,226.00' }
  const pg = { G: (id) => (id in cells ? { textContent: cells[id] } : null), PriceLock: { state: () => grahamLock() } }
  assert.deepEqual(readScreenTotals(pg), GRAHAM_SAVED)
  assert.equal(readLockState(pg).saved.total, 44448)
  assert.equal(readScreenTotals({ G: () => ({ textContent: '—' }) }), null)
  assert.equal(readScreenTotals(null), null)
  assert.equal(readLockState({ PriceLock: { state() { throw new Error('boom') } } }), null)
  assert.equal(readLockState({ PL: { state: () => ({}) } }), null) // window.PL is the plan-labels table, not the lock
  assert.equal(readScreenTotals({ G: (id) => ({ textContent: id === 'pbal' ? '−$12.50' : '$10.00' }) }).balance, -12.5)
})

// ── cross-check with the builder copy shipped in this branch ──
function loadBuilderPriceLock() {
  const html = readFileSync(resolve(here, '..', 'public', 'build', 'quote-builder.html'), 'utf8')
  const m = html.match(/<script id="ss-price-lock">([\s\S]*?)<\/script>/)
  assert.ok(m, 'public/build/quote-builder.html carries the price-lock module')
  const root = { document: { getElementById: () => null } }
  vm.runInNewContext(m[1], { window: root, CustomEvent: function () {} })
  return { PL: root.PriceLock, html }
}
test('builder copy: window.PriceLock API the CRM calls is present', () => {
  const { PL, html } = loadBuilderPriceLock()
  for (const fn of ['state', 'snapshot', 'contractBlocked', 'showGate', 'savedTotals', 'invert', 'forward', 'freshen', 'rvBaseline']) assert.equal(typeof PL[fn], 'function', fn)
  assert.match(html, /function restoreQuoteData\(data, opts\)/)
  assert.deepEqual(JSON.parse(JSON.stringify(PL.state())), { requested: false, ready: true, active: false, ok: null })
})
test('builder copy: the card totals the CRM passes invert to Graham\'s saved subtotal', () => {
  const { PL } = loadBuilderPriceLock()
  const opts = restoreOptionsFor(grahamRow())
  // Graham: 20% discount, ag tax exempt, 17% deposit, 35% additional discount (from the builder report).
  const inv = PL.invert(opts.legacyTotals, { disc: 20, tax: 6.5, agx: true, depPct: 17, adType: 'pct', adVal: 35 })
  assert.ok(inv, 'Graham\'s card totals invert')
  assert.equal(inv.depPct, 17)
  assert.ok(inv.subs.includes(59075), 'saved building subtotal $59,075')
  const m = PL.forward(59075, { disc: 20, tax: 6.5, agx: true, depPct: 17, adType: 'pct', adVal: 35 })
  assert.deepEqual([m.adjTot, m.dep, m.bal], [44448, 5222, 39226])
  // today's rules drop 8 × $150 side frames = $1,200 of subtotal → $43,545.00 on the card
  const t = PL.forward(59075 - 1200, { disc: 20, tax: 6.5, agx: true, depPct: 17, adType: 'pct', adVal: 35 })
  assert.deepEqual({ total: t.adjTot, deposit: t.dep, balance: t.bal }, GRAHAM_TODAY)
})

// ── honor target / snapshot print check ──
test('lockTarget: the card unless the builder holds an honored signed price', () => {
  assert.deepEqual(lockTarget({ saved: GRAHAM_SAVED, lock: grahamLock() }), { target: GRAHAM_SAVED, honored: false, card: GRAHAM_SAVED })
  const h = lockTarget({ saved: HONOR_CARD, lock: honorLock() })
  assert.equal(h.honored, true); assert.deepEqual(h.target, HONOR_SIGNED); assert.deepEqual(h.card, HONOR_CARD)
  assert.equal(lockTarget({ saved: HONOR_CARD, lock: honorLock({ choice: 'today' }) }).honored, false)
  assert.equal(lockTarget({ saved: HONOR_CARD, lock: null }).honored, false)
})
test('withPrintCheck: the quote PDF Building Amount is recorded next to the priced subtotal', () => {
  const html = '<tr><td>Building Amount</td><td>$59,075.00</td></tr><tr><td>Grand Total</td><td>$44,448.00</td></tr>'
  assert.equal(printedBuildingAmount(html), 59075)
  assert.equal(printedBuildingAmount('<p>nothing</p>'), null)
  assert.deepEqual(withPrintCheck({ v: 1, sub: 59075 }, html), { v: 1, sub: 59075, printSub: 59075 })
  assert.deepEqual(withPrintCheck({ v: 1, sub: 59000 }, html), { v: 1, sub: 59000, printSub: 59075, printDiverged: true })
  assert.equal(withPrintCheck(null, html), null)
  assert.deepEqual(withPrintCheck({ v: 1, sub: 1 }, ''), { v: 1, sub: 1 })
})
test('builder copy: duplicate (fresh), GCH partition placement and unpriced-file hooks are present', () => {
  const { html } = loadBuilderPriceLock()
  // a duplicate of an older quote: locked reopen only to recover the build, then priced fresh
  assert.match(html, /if\(window\.PriceLock && opts\.fresh && opts\.lock\)\{ try\{ PriceLock\.freshen\(\); \}/)
  // the 'Partition Wall' option is added before each saved location is set
  for (const s of ['_ensureLocOpt(locEl, d.rloc)', "if(cls==='wloc') _ensureLocOpt(fld, v)", "if(cls==='nloc') _ensureLocOpt(fld, v)", "_ensureLocOpt(foLocEl, d['fo-loc'])"]) assert.ok(html.includes(s), s)
  // program files / quote-log entries with no saved price get the rep note
  assert.ok(html.includes('No saved price on record for this file — shown at today’s pricing.'))
  assert.equal((html.match(/restoreQuoteData\((?:data|log\[idx\]), _plFileOpts\(/g) || []).length, 2)
})
test('builder copy: reset / revision-baseline / free-threshold hooks are present', () => {
  const { PL, html } = loadBuilderPriceLock()
  assert.equal(typeof PL.rvBaseline, 'function')
  assert.equal(PL.rvBaseline(), null) // nothing reopened
  assert.match(html, /function resetAll\(\)\{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if\(window\.PriceLock\) PriceLock\.reset\(\);/)
  assert.match(html, /function gThrAdj\(\)/)
  // One totals source (integration 9/30/26): only rc() measures the thresholds on the held price;
  // the quote PDF, contract and text copy re-run rc() and print its published pass (window._qTotals).
  assert.equal((html.match(/\+gThrAdj\(\)/g) || []).length, 1) // rc
  for (const fn of ['async function printQuote(', 'async function printContract(', 'function textQuote(']) {
    const at = html.indexOf(fn), body = html.slice(at, at + 12000)
    assert.match(body, /\n\s*rc\(\);\s*\r?\n\s*var T=window\._qTotals;/, fn)
  }
})
