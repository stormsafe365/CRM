// Manufacturer guard (src/lib/mfrGuard.js). Owner 11/17/26, Steve Coldwell: "who i need to quote through CA - open
// edited his quote & duplicated, they change the manufacturer from CA to CCI". Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { MFR_NAME, leadMfr, mfrMismatch, mfrWriteCheck, normMfr, quoteMfr, startMfrFor, switchTarget } from '../src/lib/mfrGuard.js'

const here = dirname(fileURLToPath(import.meta.url))
const modal = readFileSync(resolve(here, '../src/components/BuildQuoteModal.jsx'), 'utf8')

const steveCA = { id: 'c1', name: 'Steve Coldwell', building_mfr: 'CA' }
const leadNone = { id: 'c2', name: 'No Mfr', building_mfr: '' }
const caQuote = { id: 'q1', quote_number: 'SS-2026-11111', manufacturer: 'ca', payload_json: { fields: { bw: '30' }, mfr: 'CA' } }
const cciQuote = { id: 'q2', quote_number: 'SS-2026-60824', manufacturer: 'cci', payload_json: { fields: { bw: '30' }, mfr: 'CCI' } }

test('normMfr: the program, the card column, the payload and the lead field all read the same', () => {
  assert.equal(normMfr('CA'), 'CA'); assert.equal(normMfr('ca'), 'CA'); assert.equal(normMfr(' Carports Anywhere '), 'CA')
  assert.equal(normMfr('CCI'), 'CCI'); assert.equal(normMfr('cci'), 'CCI')
  for (const v of ['', null, undefined, 'other', 'INPUT', 'SBSI', 'MMM']) assert.equal(normMfr(v), null)
  assert.equal(quoteMfr(caQuote), 'CA'); assert.equal(quoteMfr({ manufacturer: 'cci' }), 'CCI'); assert.equal(quoteMfr(null), null)
  assert.equal(leadMfr(steveCA), 'CA'); assert.equal(leadMfr(leadNone), null)
  assert.equal(MFR_NAME.CA, 'Carports Anywhere (CA)')
})

test('a NEW quote on a lead set to CA starts on CA; never when reopening a quote or building from a design', () => {
  assert.equal(startMfrFor({ client: steveCA, programMfr: 'CCI' }), 'CA')
  assert.equal(startMfrFor({ client: steveCA, programMfr: 'CA' }), null)          // already on it
  assert.equal(startMfrFor({ client: steveCA, restoring: true, programMfr: 'CCI' }), null)
  assert.equal(startMfrFor({ client: steveCA, fromDesign: true, programMfr: 'CCI' }), null)
  assert.equal(startMfrFor({ client: leadNone, programMfr: 'CCI' }), null)        // lead not set: the program default
  assert.equal(startMfrFor({ client: { building_mfr: 'SBSI' }, programMfr: 'CCI' }), null)
})

test('Steve: a CCI quote on a lead set to CA is flagged, with "Switch to CA"', () => {
  const m = mfrMismatch({ programMfr: 'CCI', client: steveCA, quote: cciQuote })
  assert.equal(m.length, 1)
  assert.equal(m[0].against, 'lead'); assert.equal(m[0].want, 'CA'); assert.equal(m[0].have, 'CCI')
  assert.match(m[0].text, /Steve Coldwell is set to CA .* priced as CCI/)
  assert.equal(switchTarget(m), 'CA')
})

test('a CA quote that opens (or is switched) as CCI is flagged against the quote', () => {
  const m = mfrMismatch({ programMfr: 'CCI', client: leadNone, quote: caQuote })
  assert.equal(m.length, 1); assert.equal(m[0].against, 'quote'); assert.equal(switchTarget(m), 'CA')
  assert.match(m[0].text, /Quote #SS-2026-11111 was saved as CA/)
  // lead + quote both CA: one line (the lead's), not two
  const both = mfrMismatch({ programMfr: 'CCI', client: steveCA, quote: caQuote })
  assert.equal(both.length, 1); assert.equal(both[0].against, 'lead')
})

test('nothing flagged when everything agrees, nothing is known, or the program is in manual (Input) pricing', () => {
  assert.deepEqual(mfrMismatch({ programMfr: 'CA', client: steveCA, quote: caQuote }), [])
  assert.deepEqual(mfrMismatch({ programMfr: 'CCI', client: leadNone, quote: null }), [])
  assert.deepEqual(mfrMismatch({ programMfr: 'CCI', client: null, quote: cciQuote }), [])
  assert.deepEqual(mfrMismatch({ programMfr: 'CCI', client: steveCA, quote: null, inputMode: true }), [])
  assert.deepEqual(mfrMismatch({ programMfr: null, client: steveCA }), [])
})

test('the write check: Cancel is the default, the OK button names the manufacturer it will save as', () => {
  assert.equal(mfrWriteCheck({ mismatches: [] }), null)
  const c = mfrWriteCheck({ kind: 'save', mismatches: mfrMismatch({ programMfr: 'CCI', client: steveCA, quote: cciQuote }) })
  assert.equal(c.okTone, 'danger'); assert.equal(c.changed, true); assert.deepEqual(c.lines, [])
  assert.match(c.title, /priced as CCI/)
  assert.equal(c.okLabel, 'Yes — save this quote as CCI')
  assert.ok(c.notes.some((n) => /Switch to CA/.test(n)))
  assert.equal(mfrWriteCheck({ kind: 'contract', mismatches: [{ against: 'lead', want: 'CA', have: 'CCI', text: 'x' }] }).okLabel, 'Yes — generate this contract as CCI')
  assert.equal(mfrWriteCheck({ kind: 'new', mismatches: [{ against: 'quote', want: 'CA', have: 'CCI', text: 'x' }] }).okLabel, 'Yes — save this as a new quote as CCI')
})

test('wired into the builder: every write asks first, the bar shows the manufacturer, new quotes start on the lead\'s', () => {
  assert.match(modal, /async function confirmWrite\(kind, extra = \{\}\) \{\n    const pg = getProgramWindow\(\)\n[^\n]*\n[^\n]*\n    const mc = mfrGate\(pg, kind\)\n    if \(mc && \(await askConfirm\(mc\)\) !== true\) return false/)
  assert.ok(modal.includes("const mc = mfrGate(pg, 'new') // the manufacturer (lib/mfrGuard)"))
  assert.ok(modal.includes('className={`qb-mfr-chip${mfrIssues.length ? \' bad\' : \'\'}`}'))
  assert.ok(modal.includes('onClick={() => switchToMfr(mfrWant)}'))
  assert.ok(modal.includes("const want = startMfrFor({ client, restoring: !!restoreData || !!quoteRef.current?.id, fromDesign: !!fromDesign, programMfr: pg.ACTIVE_MFR })"))
  assert.ok(modal.includes("if (sel) sel.value = m\n      pg.switchMfr(m)"))
})

test('Save to Lead picker (standalone builder tab / Dashboard new quote): an existing lead set to CA / CCI is asked first', () => {
  const picker = readFileSync(resolve(here, '../src/components/SaveToLeadPicker.jsx'), 'utf8')
  assert.ok(picker.includes(".select('id, name, phone, email, status, updated_at, building_mfr')"))
  assert.ok(picker.includes('try { mm = mfrMismatch({ programMfr: pg.ACTIVE_MFR, client: target, inputMode: !!pg.INPUT_MODE }) } catch { mm = [] }'))
})
