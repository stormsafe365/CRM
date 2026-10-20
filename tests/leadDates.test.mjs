// Leads page: inquiry date column + sort by date (owner 10/20/26).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ageText, compareInquiry, fmtDay, inquiryOf } from '../src/lib/leadDates.js'

test('inquiry day: the First Contact Date, else the New York day the lead was added', () => {
  assert.deepEqual(inquiryOf({ first_contact_date: '2026-10-16', created_at: '2026-10-20T15:00:00Z' }), { day: '2026-10-16', from: 'first_contact' })
  // no first-contact date: created_at, as a New York day (10:30 pm EDT on the 16th is already the 17th in UTC)
  assert.deepEqual(inquiryOf({ first_contact_date: null, created_at: '2026-10-17T02:30:00Z' }), { day: '2026-10-16', from: 'added' })
  assert.deepEqual(inquiryOf({ first_contact_date: '', created_at: '2026-10-17T14:00:00Z' }), { day: '2026-10-17', from: 'added' })
  assert.deepEqual(inquiryOf({}), { day: null, from: null })
  assert.deepEqual(inquiryOf(null), { day: null, from: null })
  // a plain date is never shifted by the time zone
  assert.equal(inquiryOf({ first_contact_date: '2026-01-01' }).day, '2026-01-01')
})

test('format and age', () => {
  assert.equal(fmtDay('2026-10-20'), '10/20/2026')
  assert.equal(fmtDay(null), '')
  assert.equal(fmtDay('garbage'), '')
  assert.equal(ageText('2026-10-20', '2026-10-20'), 'today')
  assert.equal(ageText('2026-10-19', '2026-10-20'), '1 day ago')
  assert.equal(ageText('2026-10-08', '2026-10-20'), '12 days ago')
  assert.equal(ageText('2026-10-21', '2026-10-20'), 'in 1 day')
  assert.equal(ageText('2026-10-23', '2026-10-20'), 'in 3 days')
  assert.equal(ageText(null, '2026-10-20'), '')
})

const L = (name, first, created) => ({ name, first_contact_date: first, created_at: created })
const names = (arr) => arr.map((c) => c.name)

test('sort by inquiry date: newest first / oldest first; no date sinks; ties by when added', () => {
  const rows = [
    L('old', '2026-09-01', '2026-09-05T12:00:00Z'),
    L('new', '2026-10-19', '2026-10-19T12:00:00Z'),
    L('none', null, null),
    L('addedOnly', null, '2026-10-10T12:00:00Z'), // inquiry = the day it was added
    L('tieEarly', '2026-10-19', '2026-10-19T09:00:00Z'),
  ]
  assert.deepEqual(names([...rows].sort((a, b) => compareInquiry(a, b, 'desc'))), ['new', 'tieEarly', 'addedOnly', 'old', 'none'])
  assert.deepEqual(names([...rows].sort((a, b) => compareInquiry(a, b, 'asc'))), ['old', 'addedOnly', 'tieEarly', 'new', 'none'])
})
