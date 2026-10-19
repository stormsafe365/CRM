// Documents › Contracts sorted + the real signed day (owner 10/19/26, Peter Mawn: "he doesnt have 19
// contracts ... there is no way to mark the contract thats signed" / "his actual contract it was from
// 9/24/2026 not October 13th"). src/lib/contractDocs.js. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agreementSignedOn, agreementSignedOnDb, cleanDay, clearSignedMark, groupByLabel, isStampedCopy, localDay, markExecuted, nextExecuted,
  organizeContracts, revisionDocFor, setSignedDay, signedDayConfirmed, signedInfoOf, signedOnOf, signedPickList, withLiveExecuted,
} from '../src/lib/contractDocs.js'

const F = (label, at, n = 0) => ({ label, path: `c/contract/${Date.parse(at) + n}-${label}`, createdAt: at })

// Peter Mawn as the Doc Hub showed him (the rows are a reconstruction, not his database rows)
function peter() {
  const o = {
    id: 'o', quote_number: 'SS-2026-68012', status: 'superseded', quote_date: '2026-09-24',
    payload_json: {
      contractSent: { at: '2026-09-24T15:00:00Z', number: 'SS-2026-68012' },
      // the builder's Executed Copy, clicked 10/13 at 2 PM Eastern
      executed: { at: '2026-10-13T18:00:00.000Z', file: 'SS-2026-68012-executed-deposit-paid.pdf' },
      revisedBy: { id: 'r1' },
    },
  }
  const r1 = {
    id: 'r1', quote_number: 'SS-2026-50001', status: 'deposit_paid', quote_date: '2026-10-19',
    payload_json: { revisionOf: { id: 'o', quote_number: 'SS-2026-68012', agreement_number: 'SS-2026-68012', rev_no: '1' }, contractSent: { at: 'x', number: 'SS-2026-68012 Rev 1' } },
  }
  const d1 = { id: 'd1', quote_number: 'SS-2026-99855', status: 'sent', quote_date: '2026-09-24', payload_json: { contractSent: { at: 'x', number: 'SS-2026-99855' } } }
  const d2 = { id: 'd2', quote_number: 'SS-2026-85254', status: 'draft', quote_date: '2026-09-23', payload_json: {} }
  const gone = { id: 'g', quote_number: 'SS-2026-03736', status: 'deposit_paid', deleted_at: '2026-10-19', payload_json: { revisionOf: { id: 'o', rev_no: '1' } } }
  const files = [
    F('Peter_Mawn__Revised_Contract_FINAL.pdf', '2026-10-19T16:00:00Z'),
    F('SS-2026-68012-Rev-1-contract.pdf', '2026-10-19T15:00:00Z'),
    F('SS-2026-68012-Rev-2-contract.pdf', '2026-10-19T14:00:00Z'),
    F('SS-2026-68012-Rev-1-contract.pdf', '2026-10-19T13:00:00Z'),
    F('SS-2026-68012-executed-deposit-paid.pdf', '2026-10-13T18:00:05Z'),
    F('SS-2026-99855-contract.pdf', '2026-09-24T16:00:00Z'),
    F('SS-2026-68012-contract.pdf', '2026-09-24T15:00:00Z'),
    F('SS-2026-85254-contract.pdf', '2026-09-23T16:00:00Z'),
  ]
  return { o, r1, d1, d2, gone, quotes: [o, r1, d1, d2, gone], files }
}

test('days: local calendar day, never UTC; only real dates are accepted', () => {
  assert.equal(localDay(new Date(2026, 8, 24, 23, 30)), '2026-09-24') // 11:30 PM stays the 24th
  assert.equal(cleanDay('2026-09-24'), '2026-09-24')
  assert.equal(cleanDay('2026-02-31'), null)
  assert.equal(cleanDay('09/24/2026'), null)
  assert.equal(cleanDay(''), null)
})

test('signed day: a typed day wins; an older stamp = the LOCAL day it was clicked, flagged not confirmed', () => {
  const { o } = peter()
  assert.equal(signedOnOf(o), localDay(new Date('2026-10-13T18:00:00.000Z')))
  assert.equal(signedDayConfirmed(o), false)
  const typed = { status: 'deposit_paid', payload_json: { executed: { at: '2026-09-24', signedOn: '2026-09-24', confirmed: true } } }
  assert.equal(signedOnOf(typed), '2026-09-24')
  assert.equal(signedDayConfirmed(typed), true)
  assert.deepEqual(signedInfoOf(typed), { signed: true, date: '2026-09-24' })
  assert.equal(signedOnOf({ payload_json: {} }), null)
})

test('nextExecuted: typed day; kept when stamped again; today (not confirmed) only on a first stamp', () => {
  const now = new Date(2026, 9, 19, 21, 0) // 9 PM local: toISOString would already be the 20th
  const a = nextExecuted(null, { signedOn: '2026-09-24', filePath: 'p/signed.pdf' }, now)
  assert.equal(a.at, '2026-09-24'); assert.equal(a.signedOn, '2026-09-24'); assert.equal(a.confirmed, true); assert.equal(a.filePath, 'p/signed.pdf')
  const b = nextExecuted(a, { file: 'x-executed-deposit-paid.pdf' }, now)
  assert.equal(b.at, '2026-09-24'); assert.equal(b.confirmed, true); assert.equal(b.filePath, 'p/signed.pdf'); assert.equal(b.file, 'x-executed-deposit-paid.pdf')
  const c = nextExecuted(null, {}, now)
  assert.equal(c.at, '2026-10-19'); assert.equal(c.confirmed, false)
  // an older stamp keeps its own day (and its not-confirmed flag) when stamped again
  const d = nextExecuted({ at: '2026-10-13T18:00:00.000Z', file: 'f' }, {}, now)
  assert.equal(d.at, localDay(new Date('2026-10-13T18:00:00.000Z'))); assert.equal(d.confirmed, false)
  // a bad typed day never wins over the kept one
  assert.equal(nextExecuted(a, { signedOn: '2026-02-31' }, now).at, '2026-09-24')
})

test('the revised contract prints the AGREEMENT\'s signed day (the original), not the revision\'s', () => {
  const { o, r1, quotes } = peter()
  o.payload_json.executed = { at: '2026-09-24', signedOn: '2026-09-24', confirmed: true }
  r1.payload_json.executed = { at: '2026-10-02', signedOn: '2026-10-02', confirmed: true }
  assert.equal(agreementSignedOn(r1, quotes), '2026-09-24')
  assert.equal(agreementSignedOn(o, quotes), '2026-09-24')
  // a revision of the revision: still the agreement's day
  const r2 = { id: 'r2', status: 'deposit_paid', payload_json: { revisionOf: { id: 'r1', rev_no: '2' } } }
  assert.equal(agreementSignedOn(r2, [...quotes, r2]), '2026-09-24')
  // the root missing from the list: the quote's own day
  assert.equal(agreementSignedOn(r1, [r1]), '2026-10-02')
  // a loop in bad data never hangs
  const x = { id: 'x', payload_json: { revisionOf: { id: 'y' } } }, y = { id: 'y', payload_json: { revisionOf: { id: 'x' } } }
  assert.equal(agreementSignedOn(x, [x, y]), null)
  const doc = revisionDocFor({ original: r1, lines: [], revNo: '2', originalTotal: 1, depositPaid: 1, agreementSignedDate: '2026-09-24' })
  assert.equal(doc.signedDate, '2026-09-24')
  assert.equal(revisionDocFor({ original: r1, lines: [], revNo: '2', originalTotal: 1, depositPaid: 1 }).signedDate, '2026-10-02')
  assert.equal(revisionDocFor({ original: r1, lines: [], revNo: '2', originalTotal: 1, depositPaid: 1, agreementSignedDate: 'junk' }).signedDate, '2026-10-02')
})

test('agreementSignedOnDb walks the chain in the database', async () => {
  const { o, r1 } = peter()
  o.payload_json.executed = { at: '2026-09-24', signedOn: '2026-09-24', confirmed: true }
  const rows = [o, r1]
  const sb = { from: () => { let id; const api = { select() { return api }, eq(_k, v) { id = v; return api }, single() { return api }, then(res) { return Promise.resolve({ data: rows.find((r) => r.id === id) || null, error: null }).then(res) } }; return api } }
  assert.equal(await agreementSignedOnDb(sb, r1), '2026-09-24')
  assert.equal(await agreementSignedOnDb(sb, o), '2026-09-24')
})

test('Peter\'s Contracts: the signed order on top, generated drafts by number, his upload to sort', () => {
  const { quotes, files } = peter()
  const out = organizeContracts(files, quotes)
  // signed: the original (marked by the 10/13 Executed Copy - day not confirmed)
  assert.equal(out.agreements.length, 1)
  const a = out.agreements[0]
  assert.equal(a.agreement, 'SS-2026-68012')
  assert.equal(a.entries.length, 1)
  const s = a.entries[0]
  assert.equal(s.quote.id, 'o'); assert.equal(s.role, 'Original contract'); assert.equal(s.confirmed, false); assert.equal(s.current, false)
  assert.equal(s.stampedFile.label, 'SS-2026-68012-executed-deposit-paid.pdf')
  assert.equal(s.signedFile, null) // the customer's signed copy was never attached
  assert.deepEqual(s.generated.map((f) => f.label), ['SS-2026-68012-contract.pdf'])
  // not signed: one group per number, the newest copy shown, older copies folded
  assert.deepEqual(out.unsigned.map((g) => g.number), ['SS-2026-68012 Rev 1', 'SS-2026-99855', 'SS-2026-85254', 'SS-2026-68012 Rev 2'])
  const rev1 = out.unsigned[0]
  assert.equal(rev1.quote.id, 'r1'); assert.equal(rev1.older.length, 1); assert.equal(rev1.latest.createdAt, '2026-10-19T15:00:00Z')
  assert.equal(out.unsigned[3].old, true) // no quote has Rev 2 (the deleted redo)
  assert.deepEqual(out.uploads.map((f) => f.label), ['Peter_Mawn__Revised_Contract_FINAL.pdf'])
  // every file is shown exactly once
  const shown = [...out.signed.flatMap((x) => [x.signedFile, x.stampedFile, ...x.generated]), ...out.unsigned.flatMap((g) => [g.latest, ...g.older]), ...out.uploads].filter(Boolean)
  assert.equal(shown.length, files.length)
  assert.equal(new Set(shown.map((f) => f.path)).size, files.length)
})

test('after the owner marks his FINAL upload as the signed Revision 1 (signed 10/2)', () => {
  const { o, r1, quotes, files } = peter()
  o.payload_json.executed = { ...o.payload_json.executed, at: '2026-09-24', signedOn: '2026-09-24', confirmed: true }
  const finalPdf = files.find((f) => f.label.startsWith('Peter_Mawn'))
  r1.payload_json.executed = nextExecuted(null, { signedOn: '2026-10-02', filePath: finalPdf.path, file: finalPdf.label })
  const out = organizeContracts(files, quotes)
  const a = out.agreements[0]
  assert.deepEqual(a.entries.map((e) => e.role), ['Original contract', 'Revision 1'])
  assert.equal(a.latest.quote.id, 'r1') // the order stands on Revision 1 now
  assert.equal(a.entries[1].signedFile.label, 'Peter_Mawn__Revised_Contract_FINAL.pdf')
  assert.equal(a.entries[1].generated.length, 2) // both Rev-1 copies we generated
  assert.equal(out.uploads.length, 0)
  assert.deepEqual(out.unsigned.map((g) => g.number), ['SS-2026-99855', 'SS-2026-85254', 'SS-2026-68012 Rev 2'])
})

test('the Doc Hub stamp pair: "X.pdf" signed + "X-EXECUTED-deposit-paid.pdf" belong together', () => {
  const files = [F('Signed scan.pdf', '2026-10-01T10:00:00Z'), F('Signed_scan-EXECUTED-deposit-paid.pdf', '2026-10-01T10:01:00Z'), F('Signed scan-EXECUTED-deposit-paid.pdf', '2026-10-01T10:02:00Z')]
  const q = { id: 'q', quote_number: 'SS-2026-11111', status: 'deposit_paid', payload_json: { executed: { at: '2026-10-01T14:00:00Z', file: 'Signed scan.pdf' } } }
  const out = organizeContracts(files, [q])
  const s = out.signed[0]
  assert.equal(s.signedFile.label, 'Signed scan.pdf')
  assert.equal(s.stampedFile.label, 'Signed scan-EXECUTED-deposit-paid.pdf')
  assert.deepEqual(out.uploads.map((f) => f.label), ['Signed_scan-EXECUTED-deposit-paid.pdf'])
  assert.equal(isStampedCopy('a-EXECUTED-deposit-paid.pdf'), true)
  assert.equal(isStampedCopy('SS-1-executed-deposit-paid.pdf'), true)
  assert.equal(isStampedCopy('SS-1-contract.pdf'), false)
})

test('same-named files fold under the newest', () => {
  const g = groupByLabel([F('REV-2026-68012-20261019.pdf', '2026-10-19T10:00:00Z'), F('REV-2026-68012-20261019.pdf', '2026-10-19T12:00:00Z'), F('other.pdf', '2026-10-18T10:00:00Z')])
  assert.equal(g.length, 2)
  assert.equal(g[0].latest.createdAt, '2026-10-19T12:00:00Z')
  assert.equal(g[0].older.length, 1)
})

test('which order did the customer sign: the file\'s own match first, replaced ones last, no deleted', () => {
  const { quotes } = peter()
  const p = signedPickList(quotes, 'SS-2026-68012-Rev-1-contract.pdf')
  assert.equal(p.match.id, 'r1')
  assert.equal(p.list[0].id, 'r1')
  assert.equal(p.list[p.list.length - 1].id, 'o')
  assert.equal(p.list.some((q) => q.id === 'g'), false)
  assert.equal(signedPickList(quotes, 'Peter_Mawn__Revised_Contract_FINAL.pdf').match, null)
})

function rowsSb(rows) {
  return {
    from: () => {
      const st = { f: [], p: null }
      const api = {
        select() { return api }, single() { return api },
        eq(k, v) { st.f.push((r) => r[k] === v); return api }, neq(k, v) { st.f.push((r) => r[k] !== v); return api },
        update(p) { st.p = p; return api },
        then(res) {
          const m = rows.filter((r) => st.f.every((fn) => fn(r)))
          if (st.p) { m.forEach((r) => Object.assign(r, st.p)); return Promise.resolve({ error: null }).then(res) }
          return Promise.resolve({ data: m[0] ? JSON.parse(JSON.stringify(m[0])) : null, error: null }).then(res)
        },
      }
      return api
    },
  }
}

test('change the signed day / take the mark off; nothing else on the quote changes', async () => {
  const rows = [{ id: 'o', status: 'superseded', payload_json: { fields: { a: 1 }, executed: { at: '2026-10-13T18:00:00.000Z', file: 'f' } } }]
  const sb = rowsSb(rows)
  await setSignedDay(sb, 'o', '2026-09-24')
  assert.equal(rows[0].payload_json.executed.at, '2026-09-24')
  assert.equal(rows[0].payload_json.executed.confirmed, true)
  assert.equal(rows[0].payload_json.executed.file, 'f')
  assert.deepEqual(rows[0].payload_json.fields, { a: 1 })
  assert.equal(rows[0].status, 'superseded')
  await assert.rejects(() => setSignedDay(sb, 'o', '2026-02-31'))
  await clearSignedMark(sb, 'o')
  assert.equal('executed' in rows[0].payload_json, false)
  assert.equal(rows[0].status, 'superseded')
  await assert.rejects(() => setSignedDay(sb, 'o', '2026-09-24')) // not marked signed any more
})

test('a builder save never brings back an old signed mark (the database wins)', async () => {
  const rows = [{ id: 'o', payload_json: { executed: { at: '2026-09-24', signedOn: '2026-09-24', confirmed: true } } }]
  const sb = rowsSb(rows)
  const stale = { fields: { b: 2 }, executed: { at: '2026-10-13T18:00:00.000Z' } }
  assert.deepEqual(await withLiveExecuted(sb, 'o', stale), { fields: { b: 2 }, executed: { at: '2026-09-24', signedOn: '2026-09-24', confirmed: true } })
  rows[0].payload_json = {}
  assert.deepEqual(await withLiveExecuted(sb, 'o', stale), { fields: { b: 2 } })
  // no row id (a brand-new quote): untouched
  assert.equal(await withLiveExecuted(sb, null, stale), stale)
})

test('mark as signed through markExecuted: the file path and the typed day are kept', async () => {
  const rows = [{ id: 'r1', client_id: 'c', quote_number: 'SS-2026-50001', status: 'deposit_paid', starred: true, payload_json: {} }]
  const sb = rowsSb(rows)
  const r = await markExecuted(sb, 'r1', { signedOn: '2026-10-02', filePath: 'c/contract/1-FINAL.pdf', file: 'FINAL.pdf', stampedPath: 'c/contract/2-FINAL-EXECUTED-deposit-paid.pdf' })
  assert.equal(r.status, 'deposit_paid'); assert.equal(r.changed, false); assert.equal(r.confirmed, true)
  const ex = rows[0].payload_json.executed
  assert.equal(ex.filePath, 'c/contract/1-FINAL.pdf'); assert.equal(ex.stampedPath, 'c/contract/2-FINAL-EXECUTED-deposit-paid.pdf'); assert.equal(ex.signedOn, '2026-10-02')
})
