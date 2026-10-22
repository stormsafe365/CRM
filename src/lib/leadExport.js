// leadExport: the Leads page "Export" (owner 10/22/26: "a way to export CSV with all leads into a spreadsheet
// (Google Sheets) - I'm going to send a blast email through Mailchimp; I need all emails & contacts in an easy
// spreadsheet I can highlight and copy all emails"). ADMIN ONLY - the page hides the button from reps.
//
// Pure functions over the leads already loaded (no database, no network), so node --test covers every rule
// (tests/leadExport.test.mjs).
//
// What a row holds: contact + where the lead stands + the building the lead ITSELF carries (its own type / size
// only). Never notes, prices or anything from a quote. The CRM has no unsubscribe / consent field, so nothing
// here decides who may be emailed - the panel only reminds the owner that Mailchimp needs permission.
//
// Rules (decided once, here):
//   - Deleted leads (the Trash) are never exported.
//   - Email = trimmed + lower-cased; it must look like a real address or it is dropped (the lead stays in the
//     file only when "only leads that have an email" is off, with a blank email cell).
//   - One row per email: when two leads share an address the NEWEST lead (added last) is kept.
//   - Every CSV cell that starts with = + - @ tab or CR gets a leading apostrophe (customer-submitted names
//     flow into leads; a spreadsheet would otherwise run them as formulas). This is literal: a phone typed
//     "+1 561..." also gets the apostrophe.
//   - UTF-8 with a BOM (Excel / Sheets read accents right), CRLF line ends, RFC 4180 quoting.
import { fmtDay, inquiryOf } from './leadDates.js'
import { buildingTypeLabel, sourceLabel } from './constants.js'
import { nyDay } from './perfStats.js'

/** The exact header names Mailchimp / Sheets will see, in order. */
export const CSV_COLUMNS = [
  'Email Address', 'First Name', 'Last Name', 'Phone Number', 'Status', 'Rep',
  'Lead Source', 'County', 'ZIP', 'Inquiry Date', 'Building Interest',
]

// ---- statuses: the same groups (and labels) the Leads page tabs show ----
// Legacy values fold in exactly as the Leads page / constants.js do; anything unknown lands in 'Other' so a lead
// can never silently fall out of the export.
export const EXPORT_STATUS_GROUPS = [
  { key: 'new_lead',      label: 'New Lead',           statuses: ['new_lead'] },
  { key: 'contacted',     label: 'Attempting Contact', statuses: ['contacted'] },
  { key: 'working',       label: 'Working Leads',      statuses: ['working', 'quoted', 'follow_up'] },
  { key: 'working_hot',   label: 'Hot Leads',          statuses: ['working_hot'] },
  { key: 'contract_sent', label: 'Contract Sent',      statuses: ['contract_sent'] },
  { key: 'ordered',       label: 'Ordered',            statuses: ['ordered', 'deposit_pending', 'deposit_paid', 'scheduled', 'installed', 'done'] },
  { key: 'dead',          label: 'Dead',               statuses: ['dead', 'lost', 'cancelled'] },
]
const OTHER_GROUP = { key: 'other', label: 'Other', statuses: [] }

/** Group key of a status value ('other' when it is none of the known ones). */
export function statusGroupKey(status) {
  const s = String(status ?? '').trim()
  const g = EXPORT_STATUS_GROUPS.find((x) => x.statuses.includes(s))
  return g ? g.key : OTHER_GROUP.key
}
const groupLabel = (key) => (EXPORT_STATUS_GROUPS.find((g) => g.key === key) || OTHER_GROUP).label

const isLive = (c) => !!c && !c.deleted_at

/** [{ key, label, count }] for the panel's checkboxes: the seven groups always, 'Other' only when a lead is in it. Deleted leads are not counted. */
export function statusCounts(leads) {
  const counts = new Map()
  for (const c of leads || []) {
    if (!isLive(c)) continue
    const k = statusGroupKey(c.status)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const out = EXPORT_STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts.get(g.key) || 0 }))
  if (counts.get(OTHER_GROUP.key)) out.push({ key: OTHER_GROUP.key, label: OTHER_GROUP.label, count: counts.get(OTHER_GROUP.key) })
  return out
}

// ---- email ----
const EMAIL_RE = /^[A-Za-z0-9_][A-Za-z0-9._%+'-]*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/

/** The address, trimmed and lower-cased, or null when it is blank or does not look like a real email. */
export function normalizeEmail(raw) {
  if (raw == null) return null
  let s = String(raw).trim()
  if (/^<.*>$/.test(s)) s = s.slice(1, -1).trim() // "<jo@x.com>" pasted from a mail client
  if (!s || s.length > 254) return null
  if (!EMAIL_RE.test(s)) return null
  const at = s.lastIndexOf('@')
  const local = s.slice(0, at)
  if (local.length > 64 || local.endsWith('.') || s.includes('..')) return null
  return s.toLowerCase()
}

// ---- names ----
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof'])
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'esq', 'phd', 'dds'])
const BUSINESS = new Set(['llc', 'inc', 'corp', 'ltd', 'llp', 'pllc']) // ('Co' and 'Pa' are real surnames: not here)
const PARTICLES = new Set(['de', 'del', 'della', 'der', 'di', 'da', 'dos', 'du', 'la', 'le', 'van', 'von', 'bin', 'al', 'st', 'san'])
const bare = (t) => t.toLowerCase().replace(/[.,]/g, '')

/**
 * First / last name from one name box. "Mary Ann Smith" -> Mary Ann / Smith; "Smith, John" -> John / Smith;
 * "Maria de la Cruz" -> Maria / de la Cruz; "John Smith Jr." -> John / Smith Jr.; one word -> first only;
 * "Dr. John Smith" -> John / Smith (the title is dropped); a company ("Gulf Roofing LLC") is NOT split.
 */
export function splitName(name) {
  let s = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return { first: '', last: '' }
  // "Last, First" (but "John Smith, Jr." keeps its order: what follows the comma is only a suffix)
  const comma = s.indexOf(',')
  if (comma > 0 && s.indexOf(',', comma + 1) < 0) {
    const before = s.slice(0, comma).trim(), after = s.slice(comma + 1).trim()
    const afterWords = after.split(' ').filter(Boolean)
    if (before && afterWords.length && !afterWords.every((w) => SUFFIXES.has(bare(w)) || BUSINESS.has(bare(w)))) {
      const sfx = afterWords.filter((w) => SUFFIXES.has(bare(w)))
      const firstWords = afterWords.filter((w) => !SUFFIXES.has(bare(w)))
      return { first: firstWords.join(' '), last: [before, ...sfx].join(' ') }
    }
    s = (before + ' ' + after).replace(/\s+/g, ' ').trim()
  }
  let tokens = s.split(' ')
  if (tokens.length > 1 && HONORIFICS.has(bare(tokens[0]))) tokens = tokens.slice(1)
  if (tokens.length === 1) return { first: tokens[0], last: '' }
  if (BUSINESS.has(bare(tokens[tokens.length - 1]))) return { first: tokens.join(' '), last: '' }
  // trailing suffixes (Jr, III) stay with the last name
  let end = tokens.length
  while (end > 1 && SUFFIXES.has(bare(tokens[end - 1]))) end--
  if (end === 1) return { first: tokens.join(' '), last: '' } // "Jr Smith"-style leftovers: do not guess
  let lastStart = end - 1
  // a lower-case particle before the surname belongs to it ("de la Cruz", "van der Berg")
  while (lastStart > 1 && PARTICLES.has(bare(tokens[lastStart - 1])) && tokens[lastStart - 1] === tokens[lastStart - 1].toLowerCase()) lastStart--
  return { first: tokens.slice(0, lastStart).join(' '), last: tokens.slice(lastStart).join(' ') }
}

// ---- one row ----
const text = (v) => (v == null ? '' : String(v).trim())
const repNameOf = (users, id) => {
  if (!id) return ''
  const u = (users || []).find((x) => x && x.id === id)
  return u ? text(u.display_name) || text(u.email) : ''
}

/** The building the lead itself carries: "Residential 30x40x12", just one of them, or ''. Never read from a quote. */
export function buildingInterest(c) {
  const size = text(c?.building_size)
  const type = text(c?.building_type) ? buildingTypeLabel(text(c.building_type)) : ''
  return [type, size].filter(Boolean).join(' ')
}

/** One lead -> the cells (strings, in CSV_COLUMNS order). `email` is the already-normalized address or ''. */
export function leadRow(c, email, users) {
  const { first, last } = splitName(c?.name)
  return [
    email || '',
    first,
    last,
    text(c?.phone),
    groupLabel(statusGroupKey(c?.status)),
    repNameOf(users, c?.primary_rep),
    c?.source ? sourceLabel(c.source) : '',
    text(c?.county),
    text(c?.zip),
    fmtDay(inquiryOf(c).day),
    buildingInterest(c),
  ]
}

// ---- which leads, one row per email ----
const addedMs = (x) => {
  const t = Date.parse(x?.created_at ?? '')
  if (Number.isFinite(t)) return t
  const u = Date.parse(x?.updated_at ?? '')
  return Number.isFinite(u) ? u : 0
}
const newestFirst = (a, b) => {
  const ka = addedMs(a), kb = addedMs(b)
  if (ka !== kb) return kb - ka
  const ia = String(a?.id ?? ''), ib = String(b?.id ?? '')
  return ia < ib ? 1 : ia > ib ? -1 : 0
}

/**
 * The rows an export holds. opts = { statuses, onlyWithEmail = true }:
 *   statuses       - array / Set of group keys to INCLUDE (undefined = every status)
 *   onlyWithEmail  - keep only leads whose email looks valid
 * Returns { picked, rows, malformed }:
 *   picked    - the leads that passed the filters (before the one-row-per-email merge)
 *   rows      - [{ lead, email }] newest lead first, one per email (a lead with no valid email is its own row)
 *   malformed - leads in the chosen statuses whose email box holds something that is not an email
 */
export function selectLeads(leads, opts = {}) {
  const only = opts.onlyWithEmail !== false
  const want = opts.statuses == null ? null : new Set(opts.statuses)
  const inStatus = (leads || []).filter((c) => isLive(c) && (!want || want.has(statusGroupKey(c.status))))
  let malformed = 0
  const withMail = inStatus.map((c) => {
    const email = normalizeEmail(c.email)
    if (!email && text(c.email)) malformed++
    return { lead: c, email }
  })
  const picked = only ? withMail.filter((x) => x.email) : withMail
  const sorted = [...picked].sort((a, b) => newestFirst(a.lead, b.lead))
  const seen = new Set()
  const rows = []
  for (const x of sorted) {
    if (x.email) {
      if (seen.has(x.email)) continue
      seen.add(x.email)
    }
    rows.push(x)
  }
  return { picked, rows, malformed }
}

/** { leads, emails, rows, malformed } for the panel's live line "N leads, M unique emails". */
export function exportSummary(leads, opts = {}) {
  const { picked, rows, malformed } = selectLeads(leads, opts)
  return { leads: picked.length, emails: new Set(rows.filter((r) => r.email).map((r) => r.email)).size, rows: rows.length, malformed }
}

// ---- CSV ----
/** One CSV cell: formula-injection guard, then RFC 4180 quoting (a comma, quote, CR or LF puts it in quotes). */
export function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The whole file as one string: BOM + header + one line per row, CRLF line ends (and one after the last row). */
export function buildLeadsCsv(leads, opts = {}) {
  const { rows } = selectLeads(leads, opts)
  const lines = [CSV_COLUMNS.map(csvCell).join(',')]
  for (const { lead, email } of rows) lines.push(leadRow(lead, email, opts.users).map(csvCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** stormsafe-leads-YYYY-MM-DD.csv (the New York day, like the rest of the CRM). */
export function leadsCsvFilename(now = new Date()) {
  return `stormsafe-leads-${nyDay(now)}.csv`
}

// ---- the plain email list ----
/** The unique valid emails of the chosen statuses (lower-case, newest lead first). The "only with email" box does not matter here. */
export function emailList(leads, opts = {}) {
  const { rows } = selectLeads(leads, { ...opts, onlyWithEmail: true })
  return rows.map((r) => r.email)
}

/** The same list as clipboard text: one address per line, no trailing blank line (so a paste into Sheets adds no empty row). */
export function emailListText(leads, opts = {}) {
  return emailList(leads, opts).join('\n')
}
