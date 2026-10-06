// Unit tests for contract numbering, the revised-contract hand-off and the
// contract-sent / executed markers (src/lib/contractDocs.js). Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agreementRootOf, carryCrmMarkers, contractFileBase, contractNumberFor, contractNumberFromHtml, executedStatus, matchContractQuote,
  cardBalanceOf, executedToast, markExecuted, newDetailOf, nextRevNo, paidOf, revisedBalance, parseContractLabel, pickerRank, revisedContractNumber, revisionDocFor, revisionLabel, revOf, signedInfoOf, stripRev,
} from '../src/lib/contractDocs.js'
import { diffBuilds, revisionCandidates } from '../src/lib/revisionDiff.js'
import { stripForDuplicate } from '../src/lib/priceLockCrm.js'

const signed = { id: 'o', quote_number: 'SS-2026-00144', status: 'deposit_paid', payload_json: { fields: {} } }

test('numbering: a first contract = the quote number; a revision = original agreement + " Rev n"', () => {
  assert.equal(contractNumberFor({ quote_number: 'SS-2026-00144', payload_json: {} }), 'SS-2026-00144')
  assert.equal(contractNumberFor(null), null)
  assert.equal(revisedContractNumber(signed, '1'), 'SS-2026-00144 Rev 1')
  assert.equal(revisionLabel(2), 'Rev 2')
  // the revised quote (a duplicate with its own number) prints the agreement's number
  const rev1 = { quote_number: 'SS-2026-22222', payload_json: { revisionOf: { quote_number: 'SS-2026-00144', agreement_number: 'SS-2026-00144', rev_no: '1' } } }
  assert.equal(contractNumberFor(rev1), 'SS-2026-00144 Rev 1')
  assert.equal(agreementRootOf(rev1), 'SS-2026-00144')
  // a revision of the revision counts on: Rev 2 of the same agreement
  assert.equal(nextRevNo(rev1), '2')
  assert.equal(revisedContractNumber(rev1, nextRevNo(rev1)), 'SS-2026-00144 Rev 2')
  // the root revised twice
  assert.equal(nextRevNo({ payload_json: { revisions: [{}] } }), '2')
  assert.equal(nextRevNo(signed), '1')
})

test('numbering: a contract already sent keeps its number (never renumbered)', () => {
  const legacy = { quote_number: 'SS-2026-00144', payload_json: { contractSent: { at: '2026-10-01T10:00:00Z', number: 'SS-2026-34047' } } }
  assert.equal(contractNumberFor(legacy), 'SS-2026-34047')
  assert.equal(agreementRootOf(legacy), 'SS-2026-34047')
  assert.equal(revisedContractNumber(legacy, '1'), 'SS-2026-34047 Rev 1')
  const sentRev = { quote_number: 'SS-2026-00144', payload_json: { contractSent: { at: 'x', number: 'SS-2026-00144 Rev 1' } } }
  assert.equal(contractNumberFor(sentRev), 'SS-2026-00144 Rev 1')
  assert.equal(agreementRootOf(sentRev), 'SS-2026-00144')
  assert.equal(nextRevNo(sentRev), '2') // the Finish Revision path keeps the same quote row
  assert.equal(stripRev('SS-2026-00144 Rev 12'), 'SS-2026-00144')
  assert.equal(revOf('SS-2026-00144 Rev 12'), '12')
  assert.equal(revOf('SS-2026-00144'), null)
})

test('file names and parsing', () => {
  assert.equal(contractFileBase('SS-2026-00144 Rev 1'), 'SS-2026-00144-Rev-1')
  assert.deepEqual(parseContractLabel('SS-2026-00144-Rev-1-contract.pdf'), { base: 'SS-2026-00144', rev: '1', number: 'SS-2026-00144 Rev 1' })
  assert.deepEqual(parseContractLabel('SS-2026-00144-contract.pdf'), { base: 'SS-2026-00144', rev: null, number: 'SS-2026-00144' })
  assert.deepEqual(parseContractLabel('SS-2026-00144-executed-deposit-paid.pdf').number, 'SS-2026-00144')
  assert.equal(parseContractLabel('DocuSign signed.pdf'), null)
  assert.equal(contractNumberFromHtml('<b>SS-2026-00144 Rev 2</b> … SS-2026-00144'), 'SS-2026-00144 Rev 2')
  assert.equal(contractNumberFromHtml('<b>SS-2026-00144</b>'), 'SS-2026-00144')
})

test('Doc Hub stamp: the contract file finds its quote; ambiguous → the rep picks', () => {
  const qs = [
    { id: 'a', quote_number: 'SS-2026-00144', status: 'superseded', payload_json: { contractSent: { at: 'x', number: 'SS-2026-00144' } } },
    { id: 'b', quote_number: 'SS-2026-22222', status: 'deposit_paid', payload_json: { revisionOf: { quote_number: 'SS-2026-00144', agreement_number: 'SS-2026-00144', rev_no: '1' }, contractSent: { at: 'y', number: 'SS-2026-00144 Rev 1' } } },
    { id: 'c', quote_number: 'SS-2026-33333', status: 'sent', payload_json: {} },
    { id: 'd', quote_number: 'SS-2026-44444', status: 'sent', payload_json: {}, deleted_at: '2026-10-01' },
  ]
  assert.equal(matchContractQuote('SS-2026-00144-Rev-1-contract.pdf', qs).quote.id, 'b')
  assert.equal(matchContractQuote('SS-2026-00144-contract.pdf', qs).quote.id, 'a')
  assert.equal(matchContractQuote('SS-2026-33333-contract.pdf', qs).quote.id, 'c')
  const legacy = matchContractQuote('SS-2026-34047-contract.pdf', qs) // an old random number
  assert.equal(legacy.quote, null)
  assert.deepEqual(legacy.candidates.map((q) => q.id), ['a', 'b', 'c']) // deleted quotes are not offered
  assert.equal(matchContractQuote('Signed contract.pdf', qs).quote, null)
  // the rev without a recorded number still finds the revised quote
  const qs2 = [{ id: 'r', quote_number: 'SS-2026-55555', payload_json: { revisionOf: { quote_number: 'SS-2026-00144', rev_no: '2' } } }]
  assert.equal(matchContractQuote('SS-2026-00144-Rev-2-contract.pdf', qs2).quote.id, 'r')
})

test('executed → Deposit Paid, never a step back', () => {
  for (const s of ['draft', 'sent', 'verbal_accept', 'expired', 'declined']) assert.equal(executedStatus(s), 'deposit_paid')
  for (const s of ['deposit_paid', 'revised', 'superseded']) assert.equal(executedStatus(s), s)
})

test('signed info: the status says signed; the executed stamp gives the date', () => {
  assert.deepEqual(signedInfoOf(signed), { signed: true, date: null })
  assert.deepEqual(signedInfoOf({ status: 'deposit_paid', payload_json: { executed: { at: '2026-10-01T14:00:00Z' } } }), { signed: true, date: '2026-10-01' })
  assert.deepEqual(signedInfoOf({ status: 'sent', payload_json: { contractSent: { at: '2026-10-01' } } }), { signed: false, date: null })
})

test('the revised contract hand-off: lines, original, deposit paid (only when signed)', () => {
  const lines = [
    { id: 'u1', cat: 'leantos', kind: 'remove', printKind: 'Remove', desc: 'Remove lean-to', amount: -5240 },
    { id: 'u2', cat: 'doors', kind: 'add', printKind: 'Add', nextIndex: 1, desc: 'Add roll-up door 10×8 — Back Gable End', amount: 950 },
    { id: 'u3', cat: 'windows', kind: 'change', printKind: 'Modify', nextIndex: 0, desc: 'Window — changed: type a → b', amount: 345 },
    { id: 'u4', cat: 'windows', kind: 'move', printKind: 'Modify', nextIndex: 1, desc: 'Window — moved (placement only)', amount: 0, wall: 'Left Eave Side', from: [{ val: '12', side: 'left' }], to: [{ val: '18', side: 'left' }], fromSill: '', toSill: '4.5' },
    { id: 'u5', cat: 'doors', kind: 'add', nextIndex: 2, desc: 'Add (left off)', amount: 100, include: false },
  ]
  const doc = revisionDocFor({ original: { ...signed, payload_json: { executed: { at: '2026-10-01T09:00:00Z' } } }, lines, revNo: '1', originalTotal: 21962.63, depositPaid: 3506, adjustment: -50, adjLabel: 'Adj' })
  assert.equal(doc.agreementNo, 'SS-2026-00144')
  assert.equal(doc.signed, true)
  assert.equal(doc.signedDate, '2026-10-01')
  assert.equal(doc.depositPaid, 3506)
  assert.equal(doc.lines.length, 4)
  assert.deepEqual(doc.lines.map((l) => l.kind), ['remove', 'add', 'change', 'move'])
  assert.deepEqual(doc.lines[3], { kind: 'move', printKind: 'Modify', desc: 'Window — moved (placement only)', amount: 0, wall: 'Left Eave Side', from: [{ val: '12', side: 'left' }], to: [{ val: '18', side: 'left' }], fromSill: '', toSill: '4.5' })
  // the manual path's typed lines (printAmount = the typed figure)
  const man = revisionDocFor({ original: signed, lines: [{ kind: 'manual', printKind: 'Add', desc: 'Door', amount: 900, printAmount: 1000 }], revNo: '2', originalTotal: 1, depositPaid: 1 })
  assert.deepEqual(man.lines[0], { kind: 'manual', printKind: 'Add', desc: 'Door', amount: 1000 })
  // the older Revision Order rows (Finish Revision path)
  const rows = revisionDocFor({ original: signed, lines: [{ type: 'add', printDesc: 'Roll-Up Door 10x10 — Front Gable End', printKind: 'Add', amount: '1450' }], revNo: '1', originalTotal: 1, depositPaid: 0 })
  assert.deepEqual(rows.lines[0], { kind: 'manual', printKind: 'Add', desc: 'Roll-Up Door 10x10 — Front Gable End', amount: 1450 })
  // an unsigned original: nothing was paid on it
  const un = revisionDocFor({ original: { ...signed, status: 'sent' }, lines: [], revNo: '1', originalTotal: 100, depositPaid: 17 })
  assert.equal(un.signed, false)
  assert.equal(un.depositPaid, 0)
  // which rows to tag: added / changed (with the change's price)
  assert.deepEqual(newDetailOf(lines), { doors: { 1: { kind: 'add', delta: null } }, windows: { 0: { kind: 'change', delta: 345 } } })
})

test('a move carries where it was and is (old → new position on the contract)', () => {
  const base = { mfr: 'CCI', fields: { bw: '30', bl: '40', bh: '12' }, windows: [{ nloc: 'Left Eave Side', ntp: 'w', nqt: '1', positions: [{ val: '12', side: 'left' }], nsill: '' }] }
  const next = { ...base, windows: [{ ...base.windows[0], positions: [{ val: '18', side: 'left' }], nsill: '4.5' }] }
  const u = diffBuilds(base, next).units
  assert.equal(u.length, 1)
  assert.equal(u[0].kind, 'move')
  assert.equal(u[0].wall, 'Left Eave Side')
  assert.deepEqual(u[0].from, [{ val: '12', side: 'left' }])
  assert.deepEqual(u[0].to, [{ val: '18', side: 'left' }])
  assert.equal(u[0].fromSill, '')
  assert.equal(u[0].toSill, '4.5')
})

test('markers ride along on re-saves; a duplicate starts without them', () => {
  const prev = { contractSent: { at: 'a', number: 'n' }, executed: { at: 'b' }, revisionOf: { id: 'x' }, other: 1 }
  const out = carryCrmMarkers(prev, { fields: {} })
  assert.deepEqual(out, { fields: {}, contractSent: { at: 'a', number: 'n' }, executed: { at: 'b' }, revisionOf: { id: 'x' } })
  assert.deepEqual(carryCrmMarkers(prev, { contractSent: { at: 'new' } }).contractSent, { at: 'new' })
  const dup = stripForDuplicate({ fields: { bw: '30' }, contractSent: { at: 'a' }, executed: { at: 'b' }, revisionOf: {}, revisedBy: {}, revisions: [] }, { fromQuote: { id: 'q', quote_number: 'SS-1' } })
  for (const k of ['contractSent', 'executed', 'revisionOf', 'revisedBy', 'revisions']) assert.equal(k in dup, false, k)
})

test('revision picker: signed / ordered first, then contract sent, then the rest; replaced last', () => {
  const q = (id, status, sent, date) => ({ id, status, quote_date: date, payload_json: { fields: {}, ...(sent ? { contractSent: { at: '2026-10-0' + sent } } : {}) } })
  const list = revisionCandidates([q('plain-new', 'sent', 0, '2026-10-05'), q('sent-old', 'sent', 1, '2026-09-01'), q('sold', 'deposit_paid', 0, '2026-08-01'), q('gone', 'superseded', 0, '2026-10-06'), q('sent-new', 'draft', 2, '2026-09-20')], 'me')
  assert.deepEqual(list.map((c) => c.q.id), ['sold', 'sent-new', 'sent-old', 'plain-new', 'gone'])
  assert.deepEqual(list.map(pickerRank), [0, 1, 1, 2, 3])
})

test('one balance rule: money already paid is credited; overpaid → refund, never negative', () => {
  assert.deepEqual(revisedBalance(17622.63, 2813, 3506), { paid: 3506, additional: 0, balance: 14116.63, refund: 0 })
  assert.deepEqual(revisedBalance(25000, 4000, 3506), { paid: 3506, additional: 494, balance: 21000, refund: 0 })
  assert.deepEqual(revisedBalance(3000, 500, 3506), { paid: 3506, additional: 0, balance: 0, refund: 506 })
  // nothing paid (unsigned original): exactly the order's own balance (total − deposit)
  assert.deepEqual(revisedBalance(23075.63, 3683, 0), { paid: 0, additional: 3683, balance: 19392.63, refund: 0 })
})

test('paid across the chain: original deposit + additional deposits, never the revised card deposit', () => {
  const orig = { status: 'deposit_paid', deposit_amount: 3562, payload_json: {} }
  assert.equal(paidOf(orig, 3562), 3562)
  assert.equal(paidOf({ ...orig, status: 'sent' }, 3562), 0) // unsigned: nothing paid
  // Rev 1 lowered the deposit to 2,873: the buyer still paid 3,562
  const rev1 = { status: 'deposit_paid', deposit_amount: 2873, payload_json: { revisionOf: { signed_deposit: 3562, paid_before: 3562, paid_total: 3562 } } }
  assert.equal(paidOf(rev1, 2873), 3562)
  // Rev 1 raised it to 4,100: the additional 538 was paid with Rev 1
  const rev1up = { status: 'deposit_paid', deposit_amount: 4100, payload_json: { revisionOf: { signed_deposit: 3562, paid_before: 3562, paid_total: 4100 } } }
  assert.equal(paidOf(rev1up, 4100), 4100)
  // a Rev 1 saved before paid_total existed: max(signed deposit, its deposit)
  assert.equal(paidOf({ status: 'deposit_paid', deposit_amount: 2873, payload_json: { revisionOf: { signed_deposit: 3562 } } }, 2873), 3562)
  // the card of a revised order: balance with the paid money credited
  assert.deepEqual(cardBalanceOf({ status: 'deposit_paid', total_amount: 18001.63, deposit_amount: 2873, payload_json: { revisionOf: { paid_before: 3562 } } }), { paid: 3562, additional: 0, balance: 14439.63, refund: 0 })
  assert.equal(cardBalanceOf({ status: 'deposit_paid', total_amount: 1, deposit_amount: 1, payload_json: {} }), null)
  assert.equal(cardBalanceOf({ status: 'superseded', total_amount: 1, deposit_amount: 1, payload_json: { revisionOf: { paid_before: 1 } } }), null)
})

function fakeSb(rows, { noStar = false } = {}) {
  const writes = []
  const from = () => {
    const st = { f: [], op: 'select', p: null }
    const api = {
      select() { return api }, single() { return api },
      eq(k, v) { st.f.push((r) => r[k] === v); return api }, neq(k, v) { st.f.push((r) => r[k] !== v); return api },
      update(p) { st.op = 'update'; st.p = p; return api },
      then(res) {
        const m = rows.filter((r) => st.f.every((fn) => fn(r)))
        if (st.op === 'update') { m.forEach((r) => Object.assign(r, st.p)); writes.push({ p: st.p, ids: m.map((r) => r.id) }); return Promise.resolve({ error: null }).then(res) }
        const v = m.map((r) => { const o = { ...r }; if (noStar) delete o.starred; return o })
        return Promise.resolve({ data: v[0] || null, error: null }).then(res)
      },
    }
    return api
  }
  return { from, writes }
}
test('markExecuted: deposit paid (never a step back), executed date, star; no star column → skipped', async () => {
  const rows = [{ id: 'a', client_id: 'c', quote_number: 'SS-1', status: 'sent', starred: false, payload_json: { contractSent: { at: 'x' } } }, { id: 'b', client_id: 'c', status: 'draft', starred: true, payload_json: {} }]
  const sb = fakeSb(rows)
  const r = await markExecuted(sb, 'a', { file: 'SS-1-contract.pdf', at: '2026-10-06T12:00:00Z' })
  assert.equal(r.status, 'deposit_paid'); assert.equal(r.changed, true); assert.equal(r.starred, true)
  assert.equal(rows[0].status, 'deposit_paid'); assert.equal(rows[0].starred, true); assert.equal(rows[1].starred, false)
  assert.deepEqual(rows[0].payload_json, { contractSent: { at: 'x' }, executed: { at: '2026-10-06T12:00:00Z', file: 'SS-1-contract.pdf' } })
  assert.equal(executedToast(r, 'Sent'), 'Quote #SS-1 marked Deposit Paid · executed 10/06/2026 · ★ starred')
  const rows2 = [{ id: 'a', client_id: 'c', quote_number: 'SS-2', status: 'revised', payload_json: {} }]
  const sb2 = fakeSb(rows2, { noStar: true })
  const r2 = await markExecuted(sb2, 'a', { at: '2026-10-06T12:00:00Z' })
  assert.equal(r2.status, 'revised'); assert.equal(r2.changed, false); assert.equal(r2.starred, false)
  assert.equal(sb2.writes.length, 1) // no star writes without the column
  assert.equal(executedToast(r2, 'Revised Order'), 'Quote #SS-2 kept as Revised Order (already further along) · executed 10/06/2026')
})
