// Leads export (owner 10/22/26): the CSV file and the "copy all emails" list. Pure functions, no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CSV_COLUMNS, EXPORT_STATUS_GROUPS, buildLeadsCsv, buildingInterest, csvCell, emailList, emailListText,
  exportSummary, leadRow, leadsCsvFilename, normalizeEmail, selectLeads, splitName, statusCounts, statusGroupKey,
} from '../src/lib/leadExport.js'

// A tiny RFC 4180 reader, so the tests prove the file reads back to the same cells (quotes, commas, newlines).
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
const body = (csv) => parseCsv(csv.replace(/^﻿/, ''))

const USERS = [
  { id: 'u1', display_name: 'Jenna', email: 'jenna@stormsafesteel.com' },
  { id: 'u2', display_name: '', email: 'josh@stormsafesteel.com' },
]
const L = (o) => ({ id: 'id' + Math.random(), name: 'Pat Lee', email: 'pat@example.com', status: 'new_lead', created_at: '2026-10-01T15:00:00Z', ...o })

test('header names are exactly what Mailchimp / Sheets will see, in order', () => {
  assert.deepEqual(CSV_COLUMNS, ['Email Address', 'First Name', 'Last Name', 'Phone Number', 'Status', 'Rep', 'Lead Source', 'County', 'ZIP', 'Inquiry Date', 'Building Interest'])
  assert.deepEqual(body(buildLeadsCsv([]))[0], CSV_COLUMNS)
})

test('file format: UTF-8 BOM first, CRLF line ends only, one CRLF after the last row', () => {
  const csv = buildLeadsCsv([L({ name: 'José Núñez', email: 'jose@example.com' }), L({ name: 'Ann Bee', email: 'ann@example.com' })], { users: USERS })
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.deepEqual([...Buffer.from(csv, 'utf8').subarray(0, 3)], [0xEF, 0xBB, 0xBF])
  assert.equal(csv.slice(1).match(/\r\n/g).length, 3)           // header + 2 rows
  assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false)  // no bare LF outside quotes
  assert.ok(csv.endsWith('\r\n'))
  assert.equal(body(csv).flat().includes('José'), true)         // accents survive
})

test('quoting: commas, quotes and newlines survive a round trip', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
  assert.equal(csvCell('two\r\nlines'), '"two\r\nlines"')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(12), '12')
  const nasty = L({ name: 'Smith, John "Jack"', email: 'jack@example.com', county: 'Palm\nBeach', phone: '561,555 "1212"' })
  const rows = body(buildLeadsCsv([nasty], { users: USERS }))
  assert.equal(rows.length, 2)
  assert.equal(rows[1].length, CSV_COLUMNS.length)
  assert.equal(rows[1][1], 'John "Jack"')   // "Last, First"
  assert.equal(rows[1][2], 'Smith')
  assert.equal(rows[1][3], '561,555 "1212"')
  assert.equal(rows[1][7], 'Palm\nBeach')
})

test('a name with a newline is flattened to one line; names are never left untrimmed', () => {
  const rows = body(buildLeadsCsv([L({ name: '  Ann\n  Bee  ', email: 'ann@example.com' })]))
  assert.deepEqual([rows[1][1], rows[1][2]], ['Ann', 'Bee'])
})

test('CSV-injection guard: = + - @ tab CR get a leading apostrophe (and are still quoted when needed)', () => {
  for (const bad of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '\r=x', '=HYPERLINK("http://x","y")']) {
    const out = csvCell(bad)
    assert.ok(out.startsWith("'") || out.startsWith('"\''), JSON.stringify(bad) + ' -> ' + JSON.stringify(out))
  }
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell('@cmd'), "'@cmd")
  assert.equal(csvCell('-5'), "'-5")
  assert.equal(csvCell('\t=x'), "'\t=x")
  assert.equal(csvCell('=A1,B1'), `"'=A1,B1"`)
  // only a LEADING trigger counts
  for (const ok of ['a=b', 'x-y', 'a+b', 'me@x.com', '(561) 555-1212', "O'Brien"]) assert.equal(csvCell(ok), ok)
  // it holds through the whole builder: every field a customer can type
  const evil = L({ name: '=cmd|x @evil', email: 'ok@example.com', phone: '@SUM(1)', county: '+1', zip: '-1', building_size: '=1', building_type: null })
  const row = body(buildLeadsCsv([evil], { users: USERS }))[1]
  assert.equal(row[1], "'=cmd|x")   // first name
  assert.equal(row[2], "'@evil")    // last name
  assert.equal(row[3], "'@SUM(1)")
  assert.equal(row[7], "'+1")
  assert.equal(row[8], "'-1")
  assert.equal(row[10], "'=1")
  for (const cell of row) assert.equal(/^[=+\-@\t\r]/.test(cell), false, cell)
})

test('a leading space does not hide an injection (values are trimmed first)', () => {
  const row = body(buildLeadsCsv([L({ name: '  =evil', email: 'a@example.com' })]))[1]
  assert.equal(row[1], "'=evil")
})

test('emails: trimmed, lower-cased, malformed ones dropped', () => {
  assert.equal(normalizeEmail('  Pat.Lee@Example.COM '), 'pat.lee@example.com')
  assert.equal(normalizeEmail('<pat@example.com>'), 'pat@example.com')
  assert.equal(normalizeEmail("o'brien+fl@mail.example.co.uk"), "o'brien+fl@mail.example.co.uk")
  for (const bad of ['', '   ', null, undefined, 'pat', 'pat@', '@example.com', 'pat@example', 'pat@example.c', 'pat @example.com',
    'pat@@example.com', 'pat@exa mple.com', 'a..b@example.com', '.pat@example.com', 'pat.@example.com', '-pat@example.com', '=pat@example.com',
    'pat@example.com, jo@example.com', 'pat@example.com;jo@example.com', 'pat@-example.com', 'pat@example..com', 'mailto:pat@example.com', 'n/a', 'none']) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad))
  }
  assert.equal(normalizeEmail('a'.repeat(65) + '@example.com'), null)
})

test('name split: first / last, single word = first only', () => {
  const t = (n, f, l) => assert.deepEqual(splitName(n), { first: f, last: l }, n)
  t('John Smith', 'John', 'Smith')
  t('  John   Smith  ', 'John', 'Smith')
  t('Cher', 'Cher', '')
  t('', '', '')
  t(null, '', '')
  t('Mary Ann Smith', 'Mary Ann', 'Smith')
  t('Smith, John', 'John', 'Smith')
  t('Maria de la Cruz', 'Maria', 'de la Cruz')
  t('John Smith Jr.', 'John', 'Smith Jr.')
  t('John Smith, Jr.', 'John', 'Smith Jr.')
  t('Dr. Ann Lee', 'Ann', 'Lee')
  t("Pat O'Brien", 'Pat', "O'Brien")
  t('Anna Co', 'Anna', 'Co')
  t('Gulf Roofing LLC', 'Gulf Roofing LLC', '')   // a company is not split into a fake person
  t('Gulf Roofing, LLC', 'Gulf Roofing LLC', '')
})

test('de-dupe by lower-cased email keeps the NEWEST lead', () => {
  const old = L({ id: 'old', name: 'Pat Old', email: 'Pat@Example.com', created_at: '2026-01-05T12:00:00Z', status: 'dead' })
  const mid = L({ id: 'mid', name: 'Pat Mid', email: 'other@example.com', created_at: '2026-03-05T12:00:00Z' })
  const neu = L({ id: 'new', name: 'Pat New', email: ' pat@example.com ', created_at: '2026-09-05T12:00:00Z', status: 'working' })
  const csv = buildLeadsCsv([old, mid, neu], { users: USERS })
  const rows = body(csv).slice(1)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r[0]), ['pat@example.com', 'other@example.com'])   // newest lead first
  assert.equal(rows[0][2], 'New')
  assert.equal(rows[0][4], 'Working Leads')
  // the list does not depend on the order the leads arrive in
  const again = body(buildLeadsCsv([neu, old, mid], { users: USERS })).slice(1)
  assert.deepEqual(again, rows)
  // the same address on two leads, same moment: still exactly one row
  const twin = [L({ id: 'a', email: 'x@example.com' }), L({ id: 'b', email: 'X@example.com' })]
  assert.equal(body(buildLeadsCsv(twin)).length, 2)
})

test('status filter uses the Leads page groups; deleted leads never leave the CRM', () => {
  const leads = [
    L({ id: '1', email: 'a@example.com', status: 'new_lead' }),
    L({ id: '2', email: 'b@example.com', status: 'quoted' }),        // legacy: folds into Working Leads
    L({ id: '3', email: 'c@example.com', status: 'working_hot' }),
    L({ id: '4', email: 'd@example.com', status: 'lost' }),          // legacy: Dead
    L({ id: '5', email: 'e@example.com', status: 'ordered' }),
    L({ id: '6', email: 'f@example.com', status: 'contract_sent' }),
    L({ id: '7', email: 'g@example.com', status: 'contacted' }),
    L({ id: '8', email: 'h@example.com', status: 'new_lead', deleted_at: '2026-10-01T00:00:00Z' }),
  ]
  assert.equal(statusGroupKey('quoted'), 'working')
  assert.equal(statusGroupKey('follow_up'), 'working')
  assert.equal(statusGroupKey('cancelled'), 'dead')
  assert.equal(statusGroupKey('something_new'), 'other')
  assert.equal(statusGroupKey(null), 'other')
  const counts = Object.fromEntries(statusCounts(leads).map((s) => [s.key, s.count]))
  assert.deepEqual(counts, { new_lead: 1, contacted: 1, working: 1, working_hot: 1, contract_sent: 1, ordered: 1, dead: 1 })
  assert.deepEqual(statusCounts(leads).map((s) => s.label), ['New Lead', 'Attempting Contact', 'Working Leads', 'Hot Leads', 'Contract Sent', 'Ordered', 'Dead'])
  assert.equal(selectLeads(leads).rows.length, 7)                                         // the deleted one is out
  assert.deepEqual(emailList(leads, { statuses: ['working', 'dead'] }).sort(), ['b@example.com', 'd@example.com'])
  assert.deepEqual(emailList(leads, { statuses: [] }), [])
  assert.equal(body(buildLeadsCsv(leads, { statuses: ['ordered'] })).length, 2)
  // an unknown status is not lost: it gets an 'Other' checkbox
  const withOther = [...leads, L({ id: '9', email: 'z@example.com', status: 'brand_new_status' })]
  assert.deepEqual(statusCounts(withOther).at(-1), { key: 'other', label: 'Other', count: 1 })
  assert.equal(EXPORT_STATUS_GROUPS.length, 7)
})

test('only-with-email on: leads without a valid email are left out; off: they stay with a blank email', () => {
  const leads = [
    L({ id: '1', name: 'Has Mail', email: 'ok@example.com', created_at: '2026-10-03T00:00:00Z' }),
    L({ id: '2', name: 'No Mail', email: null, phone: '561-555-0100', created_at: '2026-10-02T00:00:00Z' }),
    L({ id: '3', name: 'Bad Mail', email: 'not an email', created_at: '2026-10-01T00:00:00Z' }),
  ]
  assert.deepEqual(body(buildLeadsCsv(leads, { onlyWithEmail: true })).slice(1).map((r) => r[1]), ['Has'])
  assert.deepEqual(body(buildLeadsCsv(leads)).slice(1).map((r) => r[1]), ['Has'])  // default = on
  const all = body(buildLeadsCsv(leads, { onlyWithEmail: false })).slice(1)
  assert.deepEqual(all.map((r) => r[1]), ['Has', 'No', 'Bad'])
  assert.deepEqual(all.map((r) => r[0]), ['ok@example.com', '', ''])                  // a malformed email is never written
  assert.equal(all[1][3], '561-555-0100')
  // two no-email leads are NOT merged with each other
  const two = [L({ id: 'a', email: '' }), L({ id: 'b', email: null })]
  assert.equal(body(buildLeadsCsv(two, { onlyWithEmail: false })).length, 3)
})

test('the live count line: N leads, M unique emails (+ how many emails looked wrong)', () => {
  const leads = [
    L({ id: '1', email: 'a@example.com' }), L({ id: '2', email: 'A@example.com' }), L({ id: '3', email: 'b@example.com' }),
    L({ id: '4', email: 'bad email' }), L({ id: '5', email: '' }),
    L({ id: '6', email: 'd@example.com', deleted_at: '2026-10-01T00:00:00Z' }),
  ]
  assert.deepEqual(exportSummary(leads, { onlyWithEmail: true }), { leads: 3, emails: 2, rows: 2, malformed: 1 })
  assert.deepEqual(exportSummary(leads, { onlyWithEmail: false }), { leads: 5, emails: 2, rows: 4, malformed: 1 })
  assert.deepEqual(exportSummary(leads, { statuses: [] }), { leads: 0, emails: 0, rows: 0, malformed: 0 })
  assert.deepEqual(exportSummary([], {}), { leads: 0, emails: 0, rows: 0, malformed: 0 })
  assert.deepEqual(exportSummary(null, {}), { leads: 0, emails: 0, rows: 0, malformed: 0 })
})

test('a row: contact, status label, rep, source, county, zip, inquiry date, the lead\'s OWN building - nothing else', () => {
  const c = L({
    id: 'x', name: 'Jo Ann Rivera', email: 'JO@Example.com', phone: '(561) 555-0100', status: 'working_hot',
    primary_rep: 'u1', source: 'facebook', county: 'Palm Beach', zip: '33401',
    first_contact_date: '2026-10-16', created_at: '2026-10-20T15:00:00Z',
    building_size: '30x40x12', building_type: 'residential',
    notes: 'SECRET NOTE', total_amount: 12345, quote_total: 999, deposit: 5,
  })
  const row = leadRow(c, normalizeEmail(c.email), USERS)
  assert.deepEqual(row, ['jo@example.com', 'Jo Ann', 'Rivera', '(561) 555-0100', 'Hot Leads', 'Jenna', 'Facebook', 'Palm Beach', '33401', '10/16/2026', 'Residential 30x40x12'])
  assert.equal(row.length, CSV_COLUMNS.length)
  assert.equal(buildLeadsCsv([c], { users: USERS }).includes('SECRET'), false)
  // inquiry date falls back to the New York day the lead was added; a rep without a display name shows the login email
  const d = leadRow(L({ primary_rep: 'u2', created_at: '2026-10-17T02:30:00Z', first_contact_date: null }), 'pat@example.com', USERS)
  assert.equal(d[5], 'josh@stormsafesteel.com')
  assert.equal(d[9], '10/16/2026')
  // no rep / unknown rep / no users loaded: blank, never "undefined" or an id
  assert.equal(leadRow(L({ primary_rep: null }), 'a@example.com', USERS)[5], '')
  assert.equal(leadRow(L({ primary_rep: 'ghost' }), 'a@example.com', USERS)[5], '')
  assert.equal(leadRow(L({ primary_rep: 'u1' }), 'a@example.com', undefined)[5], '')
  // blanks stay blank
  const blank = leadRow({ name: 'Solo' }, '', USERS)
  assert.deepEqual(blank, ['', 'Solo', '', '', 'Other', '', '', '', '', '', ''])
})

test('building interest: only what is already on the lead (type and/or size)', () => {
  assert.equal(buildingInterest({ building_size: '24x30', building_type: 'commercial' }), 'Commercial 24x30')
  assert.equal(buildingInterest({ building_size: '24x30' }), '24x30')
  assert.equal(buildingInterest({ building_type: 'ag_exempt' }), 'AG Exempt')
  assert.equal(buildingInterest({ building_size: '  ', building_type: '' }), '')
  assert.equal(buildingInterest({}), '')
  assert.equal(buildingInterest(null), '')
})

test('copy list: unique valid emails, one per line, lower-case, no trailing blank line', () => {
  const leads = [
    L({ id: '1', email: 'B@example.com', created_at: '2026-10-02T00:00:00Z' }),
    L({ id: '2', email: 'a@example.com', created_at: '2026-10-03T00:00:00Z' }),
    L({ id: '3', email: ' b@example.com ', created_at: '2026-10-04T00:00:00Z' }),
    L({ id: '4', email: 'nope' }),
    L({ id: '5', email: '' }),
    L({ id: '6', email: 'gone@example.com', deleted_at: '2026-10-05T00:00:00Z' }),
  ]
  assert.deepEqual(emailList(leads), ['b@example.com', 'a@example.com'])
  assert.equal(emailListText(leads), 'b@example.com\na@example.com')
  assert.equal(emailListText([]), '')
  assert.equal(emailListText(null), '')
  // it follows the status boxes, and ignores the "only with email" box (an email list is only emails)
  const mixed = [L({ id: 'x', email: 'w@example.com', status: 'working' }), L({ id: 'y', email: 'd@example.com', status: 'dead' })]
  assert.equal(emailListText(mixed, { statuses: ['dead'], onlyWithEmail: false }), 'd@example.com')
  // the count in "Copied N emails" is the list length, which equals the summary's unique emails
  const opts = { statuses: ['working', 'dead'] }
  assert.equal(emailList(mixed, opts).length, exportSummary(mixed, opts).emails)
})

test('file name: stormsafe-leads-YYYY-MM-DD.csv, the New York day', () => {
  assert.equal(leadsCsvFilename(new Date('2026-10-22T15:00:00Z')), 'stormsafe-leads-2026-10-22.csv')
  assert.equal(leadsCsvFilename(new Date('2026-10-23T02:00:00Z')), 'stormsafe-leads-2026-10-22.csv') // 10 pm in New York
  assert.match(leadsCsvFilename(), /^stormsafe-leads-\d{4}-\d{2}-\d{2}\.csv$/)
})

test('big list: 5,000 leads build quickly and every line has the right number of cells', () => {
  const many = Array.from({ length: 5000 }, (_, i) => L({ id: 'n' + i, name: `Lead ${i}`, email: `lead${i % 4000}@example.com`, created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }))
  const rows = body(buildLeadsCsv(many, { users: USERS }))
  assert.equal(rows.length, 4001)   // header + 4000 unique emails
  assert.ok(rows.every((r) => r.length === CSV_COLUMNS.length))
})

// UI lock (source-level, there is no browser here): reps must never get the Export control.
test('admin-only: the button sits behind isAdmin === true and the panel renders nothing for anyone else', () => {
  const page = readFileSync(new URL('../src/pages/ClientsList.jsx', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../src/components/LeadsExportPanel.jsx', import.meta.url), 'utf8')
  const btn = page.indexOf('setShowExport(true)')
  assert.ok(btn > 0)
  assert.match(page.slice(Math.max(0, btn - 120), btn), /isAdmin === true &&/)
  assert.match(page, /isAdmin === true && showExport && \(\s*<LeadsExportPanel/)
  assert.match(panel, /useIsAdmin\(\)/)
  assert.match(panel, /if \(isAdmin !== true\) return null/)
  // the panel exports straight from the loaded leads: no database call in it
  assert.equal(/supabase|fetch\(/.test(panel), false)
})
