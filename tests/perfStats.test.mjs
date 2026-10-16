// Performance page numbers (owner 10/16/26: "see how were ACTUALLY doing on a weekely basis, monthly
// basis, 3 month basis"). Sold = marked Ordered (order date); deposits = "Deposit received" entries;
// leads named "test" left out. Every number checked against a small hand-counted data set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, computePerformance, daysBetween, isRealTouch, isTestName, mondayOf, nyDay, periodFor, plainDay, rangeLabel, stageGroup, trendBuckets } from '../src/lib/perfStats.js'

test('New York days: an evening entry stays on its own day (not the next UTC day)', () => {
  assert.equal(nyDay('2026-10-17T02:30:00Z'), '2026-10-16') // 10:30 pm EDT on the 16th
  assert.equal(nyDay('2026-10-16T04:30:00Z'), '2026-10-16') // 12:30 am EDT
  assert.equal(nyDay('2026-12-01T04:59:00Z'), '2026-11-30') // EST: 11:59 pm on the 30th
  assert.equal(nyDay(null), null)
  assert.equal(nyDay('nope'), null)
  assert.equal(plainDay('2026-10-16'), '2026-10-16') // a date column is never shifted
  assert.equal(plainDay('2026-10-16T00:00:00'), '2026-10-16')
  assert.equal(plainDay(''), null)
})

test('weeks run Monday to Sunday; periods include both ends', () => {
  assert.equal(mondayOf('2026-10-16'), '2026-10-12') // Friday
  assert.equal(mondayOf('2026-10-18'), '2026-10-12') // Sunday belongs to the week before
  assert.equal(mondayOf('2026-10-12'), '2026-10-12')
  const today = '2026-10-16'
  const w = periodFor('this_week', today)
  assert.deepEqual([w.from, w.to, w.days, w.grain, w.toDate], ['2026-10-12', '2026-10-16', 5, 'week', true])
  assert.equal(w.range, 'Oct 12 – 16, 2026')
  const lw = periodFor('last_week', today)
  assert.deepEqual([lw.from, lw.to, lw.days], ['2026-10-05', '2026-10-11', 7])
  const tm = periodFor('this_month', today)
  assert.deepEqual([tm.from, tm.to], ['2026-10-01', '2026-10-16'])
  const lm = periodFor('last_month', today)
  assert.deepEqual([lm.from, lm.to, lm.grain], ['2026-09-01', '2026-09-30', 'week'])
  const q = periodFor('last_3_months', today)
  assert.deepEqual([q.from, q.to, q.grain], ['2026-07-17', '2026-10-16', 'month'])
  assert.equal(periodFor('ytd', today).from, '2026-01-01')
  assert.equal(periodFor('last_12_months', today).from, '2025-10-17')
  // custom: swapped ends are put in order; never past today
  const c = periodFor('custom', today, { from: '2026-10-20', to: '2026-09-15' })
  assert.deepEqual([c.from, c.to], ['2026-09-15', '2026-10-16'])
  assert.equal(periodFor('custom', today, {}).key, 'this_week') // no dates: this week
  assert.equal(rangeLabel('2026-09-28', '2026-10-04'), 'Sep 28 – Oct 4, 2026')
  assert.equal(rangeLabel('2025-12-29', '2026-01-04'), 'Dec 29, 2025 – Jan 4, 2026')
})

test('month math: the 31st three months back, leap years', () => {
  assert.equal(periodFor('last_3_months', '2026-05-31').from, '2026-03-01') // Feb 28 + 1 day
  assert.equal(periodFor('last_month', '2028-03-10').to, '2028-02-29')
  assert.equal(daysBetween('2026-10-01', '2026-10-16'), 15)
  assert.equal(addDays('2026-11-01', 1), '2026-11-02') // across the DST change
})

test('the trend: 6 weeks ending with the period, or months for long periods', () => {
  const w = trendBuckets(periodFor('this_week', '2026-10-16'))
  assert.equal(w.length, 6)
  assert.deepEqual([w[0].from, w[5].from, w[5].to, w[5].partial], ['2026-09-07', '2026-10-12', '2026-10-16', true]) // stops at today
  assert.equal(w[4].partial, undefined)
  assert.equal(w[5].label, 'Week of Oct 12')
  const m = trendBuckets(periodFor('last_3_months', '2026-10-16'))
  assert.deepEqual(m.map((b) => b.label), ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'])
  assert.equal(m[4].to, '2026-09-30')
  assert.deepEqual([m[5].to, m[5].partial], ['2026-10-16', true])
  const lm = trendBuckets(periodFor('last_month', '2026-10-16')) // Sep 1 - 30 by week: the last week stops on the 30th
  assert.deepEqual([lm[5].from, lm[5].to], ['2026-09-28', '2026-09-30'])
  assert.equal(trendBuckets(periodFor('last_12_months', '2026-10-16')).length, 12)
})

test('who counts: stages, test names, real follow-ups', () => {
  assert.equal(stageGroup('working_hot'), 'open')
  assert.equal(stageGroup('deposit_pending'), 'open') // "Pending Deposit": not marked Ordered yet
  assert.equal(stageGroup('ordered'), 'ordered')
  assert.equal(stageGroup('installed'), 'ordered')
  assert.equal(stageGroup('lost'), 'dead')
  assert.equal(stageGroup('weird'), 'other')
  for (const n of ['Test Lead', 'E2E Test Lead', 'jake-test', 'TEST', 'Test1', 'Angie test']) assert.equal(isTestName(n), true, n)
  for (const n of ['Celeste Moore', 'Contest Winner', 'Attest LLC', 'Pat Sample', '']) assert.equal(isTestName(n), false, n)
  assert.equal(isRealTouch({ type: 'call', created_by: 'u1' }), true)
  assert.equal(isRealTouch({ type: 'note', created_by: 'u1', kind: 'design_request' }), false) // the design page's note
  assert.equal(isRealTouch({ type: 'note', created_by: null }), false) // automatic
  assert.equal(isRealTouch({ type: 'status_change', created_by: 'u1' }), false)
})

// ── A small hand-counted data set ──────────────────────────────────────────────────────────
const U = [
  { id: 'u1', display_name: 'Missy', email: 'm@x' },
  { id: 'u2', display_name: 'Vanize', email: 'v@x' },
  { id: 'u3', display_name: 'missy', email: 'm2@x' }, // a re-created login: same person
]
const C = (id, o) => ({ id, name: id, status: 'new_lead', primary_rep: 'u1', source: 'facebook', created_at: '2026-10-13T15:00:00Z', first_contact_date: null, order_date: null, deleted_at: null, phone: null, email: null, ...o })
const clients = [
  C('a', { created_at: '2026-10-12T14:00:00Z' }), // Mon, this week
  C('b', { primary_rep: 'u2', source: null, created_at: '2026-10-14T13:00:00Z', status: 'working' }),
  C('c', { primary_rep: 'u3', created_at: '2026-10-16T01:30:00Z', status: 'ordered', order_date: '2026-10-15' }), // Oct 15 evening NY
  C('d', { created_at: '2026-09-01T12:00:00Z', first_contact_date: '2026-08-20', status: 'ordered', order_date: '2026-10-13' }), // old lead, sold this week
  C('e', { created_at: '2026-10-13T12:00:00Z', first_contact_date: '2026-10-02' }), // came in last week (backdated)
  C('f', { created_at: '2026-10-14T12:00:00Z', deleted_at: '2026-10-15T00:00:00Z' }), // in the Trash
  C('Test Lead', { created_at: '2026-10-14T12:00:00Z' }), // left out
  C('g', { created_at: '2026-10-15T12:00:00Z', status: 'ordered', order_date: null }), // ordered, no date: not counted, flagged
  C('h', { created_at: '2026-06-01T12:00:00Z', status: 'working', phone: '(561) 555-0100' }), // quiet for months
  C('i', { created_at: '2026-10-15T12:00:00Z', status: 'working', phone: '561-555-0100' }), // same phone as h: a possible duplicate
  C('s', { created_at: '2026-10-14T12:00:00Z' }), // seed sample row
]
const Q = (id, client_id, o) => ({ id, client_id, created_at: '2026-10-14T16:00:00Z', status: 'draft', total_amount: 10000, deleted_at: null, parent_quote_id: null, starred: false, quote_number: id, ...o })
const quotes = [
  Q('q1', 'a', { total_amount: 12000, created_at: '2026-10-12T18:00:00Z' }),
  Q('q2', 'a', { total_amount: 15000, created_at: '2026-10-15T18:00:00Z' }), // a's latest this week
  Q('q3', 'b', { total_amount: null }), // no price: not counted
  Q('q4', 'c', { total_amount: 30000, status: 'deposit_paid' }),
  Q('q5', 'd', { total_amount: 40000, created_at: '2026-09-02T12:00:00Z', status: 'draft' }), // d: no sold quote, newest priced
  Q('q6', 'd', { total_amount: 42000, created_at: '2026-09-05T12:00:00Z', starred: true }), // d: the starred one wins
  Q('q7', 'f', { total_amount: 9999 }), // lead in the Trash
  Q('q8', 'b', { total_amount: 5000, deleted_at: '2026-10-15T00:00:00Z' }), // quote in the Trash
  Q('q9', 'b', { total_amount: 8000, created_at: '2026-10-15T12:00:00Z', parent_quote_id: 'q3' }), // a revision copy
  Q('q10', 'e', { total_amount: 20000, status: 'revised' }), // sold quote, lead not marked ordered: flagged
]
const touches = [
  { id: 't1', client_id: 'a', type: 'call', created_by: 'u1', created_at: '2026-10-12T20:00:00Z' }, // 6 h after a came in
  { id: 't2', client_id: 'b', type: 'email', created_by: 'u2', created_at: '2026-10-16T13:00:00Z' }, // 48 h
  { id: 't3', client_id: 'b', type: 'note', created_by: 'u2', created_at: '2026-10-15T13:00:00Z', kind: 'design_request' }, // not a follow-up
  { id: 't4', client_id: 'c', type: 'call', created_by: 'u3', created_at: '2026-10-16T02:30:00Z' }, // 1 h; logged by the re-created Missy login
  { id: 't5', client_id: 'h', type: 'call', created_by: 'u1', created_at: '2026-07-01T12:00:00Z' }, // h: last touch months ago
  { id: 't6', client_id: 'a', type: 'status_change', created_by: 'u1', created_at: '2026-10-13T12:00:00Z' }, // not a follow-up
]
const statusChanges = [
  { client_id: 'h', to: 'dead', created_by: 'u1', created_at: '2026-10-14T12:00:00Z' },
  { client_id: 'h', to: 'working', created_by: 'u1', created_at: '2026-10-14T13:00:00Z' }, // revived, still lost once this week
  { client_id: 'b', to: 'dead', created_by: null, created_at: '2026-10-14T12:00:00Z' }, // automatic: not counted
]
const payments = [
  { id: 'p1', client_id: 'c', kind: 'deposit', amount: 5100, received_on: '2026-10-15', method: 'Check' },
  { id: 'p2', client_id: 'd', kind: 'deposit', amount: 7140, received_on: '2026-10-09' }, // last week
  { id: 'p3', client_id: 'd', kind: 'deposit', amount: 100, received_on: '2026-10-14', deleted_at: '2026-10-15T00:00:00Z' }, // removed
  { id: 'p4', client_id: 'f', kind: 'deposit', amount: 999, received_on: '2026-10-14' }, // lead in the Trash
]
const data = { clients, quotes, touches, statusChanges, users: U, payments, sampleIds: ['s'] }
const TODAY = '2026-10-16'
const NOW = Date.parse('2026-10-16T18:00:00Z')

test('this week, hand-counted', () => {
  const r = computePerformance(data, periodFor('this_week', TODAY), { today: TODAY, now: NOW })
  // leads in: a, b, c, g, i (d came in Aug 20, e on Oct 2, f trashed, Test Lead + sample left out)
  assert.equal(r.main.leadsIn, 5)
  // quoted: a (latest q2 15000), c (q4 30000), b (q9 8000), e (q10 20000) - q3 no price, q8 trashed, q7 trashed lead
  assert.equal(r.main.customersQuoted, 4)
  assert.equal(r.main.quotedValue, 15000 + 30000 + 8000 + 20000)
  assert.equal(r.main.quotesMade, 5) // q1, q2, q4, q9, q10
  assert.equal(r.main.revisions, 1)
  // sold: c (Oct 15, sold quote 30000) and d (Oct 13, starred quote 42000); g has no order date
  assert.equal(r.main.sold, 2)
  assert.equal(r.main.soldValue, 72000)
  assert.equal(r.main.avgDeal, 36000)
  assert.equal(r.deals.find((x) => x.id === 'd').amountFrom, 'starred')
  assert.equal(r.deals.find((x) => x.id === 'c').deposit, 5100)
  // deposits received this week: p1 only (p2 last week, p3 removed, p4 trashed lead)
  assert.equal(r.main.deposits, 5100)
  assert.equal(r.main.depositCount, 1)
  assert.equal(r.main.lost, 1) // h, once
  // close rate: of a, b, c, g, i -> c and g are Ordered now
  assert.deepEqual([r.closeRate.ordered, r.closeRate.of], [2, 5])
  // handling: a 6 h, b 48 h (the design note does not count), c 1 h; g and i never followed up
  assert.equal(r.handling.followed, 3)
  assert.equal(r.handling.medianHours, 6)
  assert.equal(r.handling.within24, 2)
  // the period's new leads by source
  assert.deepEqual(r.sources.map((s) => [s.source, s.leads]), [['facebook', 4], ['', 1]])
  assert.equal(r.checks.noSource, 1)
  // reps: Missy = u1 + u3 merged
  const missy = r.reps.find((x) => x.name === 'Missy')
  const vanize = r.reps.find((x) => x.name === 'Vanize')
  assert.equal(r.reps.filter((x) => x.name.toLowerCase() === 'missy').length, 1)
  assert.equal(missy.newLeads, 4) // a, c, g, i
  assert.equal(missy.followUps, 2) // t1 (u1) + t4 (u3); t5 was July
  assert.equal(missy.sold, 2)
  assert.equal(missy.soldValue, 72000)
  assert.equal(missy.deposits, 5100)
  assert.equal(vanize.newLeads, 1)
  assert.equal(vanize.followUps, 1) // t2 only
  assert.equal(vanize.customersQuoted, 1)
  assert.equal(vanize.quotedValue, 8000)
  assert.equal(r.totals.newLeads, 5)
  // quiet 14+ days: h (last touch Jul 1) - open leads only
  assert.equal(missy.quiet, 1)
  // open pipeline now: a (new), b (working), e (new), h (working), i (working)
  assert.equal(r.openTotal, 5)
  assert.equal(r.pipeline.find((s) => s.key === 'working').count, 3)
  assert.equal(r.pipeline.find((s) => s.key === 'new_lead').count, 2)
  assert.deepEqual(r.ages, { d30: 4, d90: 0, d180: 1, older: 0, unknown: 0 })
  // numbers to check
  assert.deepEqual(r.checks.orderedNoDate.map((x) => x.id), ['g'])
  assert.deepEqual(r.checks.soldQuoteNotOrdered.map((x) => x.id), ['e'])
  assert.deepEqual(r.checks.soldFromOther.map((x) => x.id), ['d'])
  assert.deepEqual(r.checks.testLeads.map((x) => x.name), ['Test Lead'])
  assert.equal(r.checks.dupes.length, 1)
  assert.equal(r.checks.dupes[0].by, 'phone')
  // previous five weeks' average of new leads (for "N came in; the previous five weeks averaged ...")
  assert.equal(r.prevAvgLeads, 1 / 5) // e on Oct 2
})

test('before the deposit update (022) the page says "not tracked", never $0', () => {
  const r = computePerformance({ ...data, payments: null }, periodFor('this_week', TODAY), { today: TODAY, now: NOW })
  assert.equal(r.tracked, false)
  assert.equal(r.main.deposits, null)
  assert.equal(r.trend[5].deposits, null)
})

test('the last trend row always equals the numbers above it (this week, this month, last month, 3 months)', () => {
  for (const k of ['this_week', 'this_month', 'last_month', 'last_3_months', 'ytd']) {
    const r = computePerformance(data, periodFor(k, TODAY), { today: TODAY, now: NOW })
    const last = r.trend[r.trend.length - 1]
    if (last.from > r.period.from) continue // a longer period spans several rows
    for (const f of ['leadsIn', 'customersQuoted', 'quotedValue', 'sold', 'soldValue', 'deposits']) assert.equal(last[f], r.main[f], k + ' ' + f)
  }
  const wk = computePerformance(data, periodFor('this_week', TODAY), { today: TODAY, now: NOW })
  const last = wk.trend[5]
  for (const f of ['leadsIn', 'customersQuoted', 'quotedValue', 'sold', 'soldValue', 'deposits']) assert.equal(last[f], wk.main[f], 'this week ' + f)
})

test('the trend counts each week on its own', () => {
  const r = computePerformance(data, periodFor('this_week', TODAY), { today: TODAY, now: NOW })
  const last = r.trend[5]
  assert.equal(last.leadsIn, 5)
  assert.equal(last.sold, 2)
  const prev = r.trend[4] // Oct 5 - 11
  assert.equal(prev.leadsIn, 0)
  assert.equal(prev.deposits, 7140)
  assert.equal(r.trend[3].label, 'Week of Sep 28')
  assert.equal(r.trend[3].leadsIn, 1) // e came in Fri Oct 2
})

test('a sold lead with no priced quote: counted as sold, amount unknown (not $0 in the average)', () => {
  const d2 = { ...data, clients: [C('z', { status: 'ordered', order_date: '2026-10-14' })], quotes: [], touches: [], payments: [] }
  const r = computePerformance(d2, periodFor('this_week', TODAY), { today: TODAY, now: NOW })
  assert.equal(r.main.sold, 1)
  assert.equal(r.main.soldNoAmount, 1)
  assert.equal(r.main.soldValue, 0)
  assert.equal(r.main.avgDeal, null)
})
