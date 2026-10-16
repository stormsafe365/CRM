// Deposits received on the order screen + the printed Performance report (owner 10/16/26).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDepositAmount } from '../src/lib/payments.js'
import { buildPerformanceHtml, reportChecks } from '../src/lib/perfReportHtml.js'
import { computePerformance, periodFor } from '../src/lib/perfStats.js'

test('deposit amounts: what a rep types', () => {
  assert.equal(parseDepositAmount('5100'), 5100)
  assert.equal(parseDepositAmount('$5,100.50'), 5100.5)
  assert.equal(parseDepositAmount(' 5100.5 '), 5100.5)
  for (const bad of ['', '0', '-50', '5,1o0', '5100.505', 'abc', '1e5', '10000000']) assert.equal(parseDepositAmount(bad), null, bad)
})

const data = {
  users: [{ id: 'u1', display_name: '<b>Missy</b>', email: 'm@x' }],
  clients: [
    { id: 'c1', name: 'Pat <script>alert(1)</script>', status: 'ordered', order_date: '2026-10-14', primary_rep: 'u1', source: null, created_at: '2026-10-13T15:00:00Z' },
    { id: 'c2', name: 'Lee & Sons', status: 'working', primary_rep: 'u1', source: 'facebook', created_at: '2026-10-14T15:00:00Z' },
  ],
  quotes: [{ id: 'q1', client_id: 'c1', created_at: '2026-10-13T16:00:00Z', status: 'deposit_paid', total_amount: 30000.5, quote_number: 'SS-1' }],
  touches: [],
  statusChanges: [],
  payments: [{ id: 'p1', client_id: 'c1', kind: 'deposit', amount: 5100, received_on: '2026-10-14', method: 'Check' }],
  sampleIds: [],
}

test('the printed report: the same numbers, names escaped, deposits shown', () => {
  const r = computePerformance(data, periodFor('this_week', '2026-10-16'), { today: '2026-10-16', now: Date.parse('2026-10-16T18:00:00Z') })
  const html = buildPerformanceHtml(r, { summary: ['2 new leads came in <so far>.'], sourceLabel: (v) => v || 'Not recorded' })
  assert.match(html, /^<!doctype html>/)
  assert.ok(!html.includes('<script>alert'), 'a lead name never becomes markup')
  assert.ok(html.includes('Pat &lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('&lt;b&gt;Missy&lt;/b&gt;'))
  assert.ok(html.includes('2 new leads came in &lt;so far&gt;.'))
  assert.ok(html.includes('$30,000.50'), 'the sold amount, to the cent')
  assert.ok(html.includes('$5,100'), 'the deposit')
  assert.ok(html.includes('Oct 12 – 16, 2026'))
  assert.ok(html.includes('size: letter'))
})

test('before the deposit update the report says "Not tracked yet", never $0', () => {
  const r = computePerformance({ ...data, payments: null }, periodFor('this_week', '2026-10-16'), { today: '2026-10-16' })
  const html = buildPerformanceHtml(r)
  assert.ok(html.includes('Not tracked yet'))
})

test('the report styles are its own (in the web CRM they sit next to the CRM styles)', () => {
  const r = computePerformance(data, periodFor('this_week', '2026-10-16'), { today: '2026-10-16' })
  const html = buildPerformanceHtml(r)
  const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))
  for (const line of css.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('@page'))) {
    assert.ok(line.startsWith('.prdoc'), `unscoped rule: ${line.slice(0, 60)}`)
  }
  assert.ok(!/class="(tile|tiles|head|brand|title|bar|mini|summary|two)"/.test(html), 'no class names the CRM also uses')
  assert.ok(html.includes('class="prdoc"'))
})

test('the report lists every check the page lists', () => {
  const c = {
    orderedNoDate: [{ id: 1, name: 'A' }], soldQuoteNotOrdered: [{ id: 2, name: 'B' }], soldFromOther: [{ id: 3, name: 'C' }], soldNoPrice: [{ id: 4, name: 'D' }],
    multiSold: [{ id: 5, name: 'E' }], depositPending: [{ id: 6, name: 'F' }], unknownStatus: [{ id: 7, name: 'G', status: 'weird' }], unknownRep: [{ id: 8, name: 'H' }],
    dupes: [{ ids: [1, 9], names: ['A', 'I'] }], testLeads: [{ id: 10, name: 'Test <x>' }],
  }
  const lines = reportChecks(c)
  assert.equal(lines.length, 10)
  assert.ok(lines.some((l) => l.includes('G (weird)')))
  assert.ok(lines.some((l) => l.includes('Test &lt;x&gt;')))
})
