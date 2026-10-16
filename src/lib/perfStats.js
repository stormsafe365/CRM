// perfStats: the Performance page's numbers (owner 10/16/26: "i need something like this on my CRM
// where i can pull stats and see how were ACTUALLY doing on a weekely basis, monthly basis, 3 month
// basis etc"). Pure functions over rows already loaded (perfLoad.js) - no database here, so every
// number is unit-tested (tests/perfStats.test.mjs).
//
// Owner rulings (10/16/26):
//   - SOLD = the lead was marked Ordered; it counts on its order date (clients.order_date).
//   - Deposits = the "Deposit received" entries on the order screen (payments table, 022) - money
//     actually received, by the date it was received. Before 022 the page says "not tracked yet".
//   - Leads whose name has the word "test" are left out (and listed, so nothing hides).
// Definitions decided from the code (see the page's "How these are counted"):
//   - Dates are New York calendar days; weeks run Monday to Sunday.
//   - A lead "came in" on its first-contact date (the date the rep enters; the CRM fills in the day it
//     was entered), else the day it was entered.
//   - Quotes count when saved with a price (no price = unfinished, not counted); amounts are the quote
//     total the customer sees (sales tax included).
//   - A follow-up = a call / email / meeting / note a rep logged (not automatic entries).

export const TZ = 'America/New_York'

// ── Calendar days (YYYY-MM-DD strings; compared as strings) ───────────────────────────
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
/** The New York calendar day of an instant (timestamptz string / Date / ms). null when unreadable. */
export function nyDay(t) {
  if (t == null || t === '') return null
  const d = t instanceof Date ? t : new Date(t)
  if (!Number.isFinite(d.getTime())) return null
  return NY.format(d) // en-CA = YYYY-MM-DD
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** A plain date column ('2026-10-16'); never through new Date() (that would shift it by the time zone). */
export function plainDay(s) {
  if (typeof s !== 'string') return null
  const v = s.slice(0, 10)
  return DAY_RE.test(v) ? v : null
}
const toUTC = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (day, n) => fromUTC(toUTC(day) + n * 86400000)
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000) // b - a
/** Monday of that day's week. */
export const mondayOf = (day) => addDays(day, -((new Date(toUTC(day)).getUTCDay() + 6) % 7))
const firstOfMonth = (day) => `${day.slice(0, 7)}-01`
const addMonths = (day, n) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return fromUTC(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last)))
}
const endOfMonth = (day) => addDays(addMonths(firstOfMonth(day), 1), -1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "Oct 12" / "Oct 12, 2026" */
export function dayLabel(day, withYear = false) {
  const [y, m, d] = day.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`
}
/** "Oct 12 – 16, 2026" / "Sep 28 – Oct 4, 2026" / "Dec 29, 2025 – Jan 4, 2026" */
export function rangeLabel(from, to) {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  if (from === to) return dayLabel(from, true)
  if (fy !== ty) return `${dayLabel(from, true)} – ${dayLabel(to, true)}`
  if (fm === tm) return `${dayLabel(from)} – ${td}, ${ty}`
  return `${dayLabel(from)} – ${dayLabel(to)}, ${ty}`
}
export const inRange = (day, p) => !!day && day >= p.from && day <= p.to

// ── Periods ─────────────────────────────────────────────────────────────────────────────
export const PERIODS = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: 'Last 3 months' },
  { key: 'last_6_months', label: 'Last 6 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'last_12_months', label: 'Last 12 months' },
  { key: 'custom', label: 'Custom dates' },
]

/**
 * The days a period covers, both ends included. `today` = the New York day now. Rolling periods end
 * today ("Last 3 months" = the same day 3 months ago + 1 through today). The trend under the numbers is
 * by week for a period up to 5 weeks long, else by month.
 */
export function periodFor(key, today, custom = {}) {
  let from
  let to = today
  let label = PERIODS.find((p) => p.key === key)?.label || 'This week'
  let toDate = false // "to date" = the period is still running
  switch (key) {
    case 'last_week': from = addDays(mondayOf(today), -7); to = addDays(from, 6); break
    case 'this_month': from = firstOfMonth(today); toDate = true; break
    case 'last_month': from = addMonths(firstOfMonth(today), -1); to = endOfMonth(from); break
    case 'last_3_months': from = addDays(addMonths(today, -3), 1); break
    case 'last_6_months': from = addDays(addMonths(today, -6), 1); break
    case 'last_12_months': from = addDays(addMonths(today, -12), 1); break
    case 'ytd': from = `${today.slice(0, 4)}-01-01`; toDate = true; break
    case 'custom': {
      const a = plainDay(custom.from)
      const b = plainDay(custom.to)
      if (a && b) { from = a <= b ? a : b; to = a <= b ? b : a } else { from = mondayOf(today); key = 'this_week'; label = 'This week' }
      if (to > today) to = today
      if (from > to) from = to
      break
    }
    default: key = 'this_week'; label = 'This week'; from = mondayOf(today); toDate = true
  }
  const days = daysBetween(from, to) + 1
  const grain = days <= 35 ? 'week' : 'month'
  return { key, label, from, to, days, grain, toDate, range: rangeLabel(from, to) }
}

/**
 * The trend columns: 6 weeks (or months) ending with the period's last week / month, oldest first.
 * The last column stops at the period's last day (so it matches the numbers above it; nothing dated
 * after today is ever counted): `partial` marks it, `upTo` = its last day.
 */
export function trendBuckets(p, count = 6) {
  const out = []
  if (p.grain === 'week') {
    const lastMon = mondayOf(p.to)
    for (let i = count - 1; i >= 0; i--) {
      const from = addDays(lastMon, -7 * i)
      out.push({ from, to: addDays(from, 6), label: `Week of ${dayLabel(from)}` })
    }
  } else {
    // every month the period touches (Last 12 months = 13: the first one partly), at least `count`
    const [fy, fm] = p.from.split('-').map(Number)
    const [ty, tm] = p.to.split('-').map(Number)
    const months = Math.max(count, (ty - fy) * 12 + (tm - fm) + 1)
    const lastFirst = firstOfMonth(p.to)
    for (let i = Math.min(months, 13) - 1; i >= 0; i--) {
      const from = addMonths(lastFirst, -i)
      const [y, m] = from.split('-').map(Number)
      out.push({ from, to: endOfMonth(from), label: `${MONTHS[m - 1]} ${y}`, long: `${LONG_MONTHS[m - 1]} ${y}` })
    }
  }
  const last = out[out.length - 1]
  if (last && last.to > p.to) Object.assign(last, { to: p.to, partial: true, upTo: p.to })
  // inPeriod = wholly inside the period (these rows add up to the numbers above); startsBefore = the
  // period begins part-way through this row
  for (const b of out) Object.assign(b, { inPeriod: b.from >= p.from && b.to <= p.to, startsBefore: b.from < p.from && b.to >= p.from })
  return out
}

// ── Who / what counts ───────────────────────────────────────────────────────────────────
export const OPEN_STAGES = [
  { key: 'new_lead', label: 'New lead', statuses: ['new_lead'] },
  { key: 'contacted', label: 'Attempting to contact', statuses: ['contacted'] },
  { key: 'working', label: 'Working', statuses: ['working', 'quoted', 'follow_up'] },
  { key: 'working_hot', label: 'Working hot', statuses: ['working_hot'] },
  { key: 'contract_sent', label: 'Contract sent', statuses: ['contract_sent'] },
  { key: 'deposit_pending', label: 'Pending deposit', statuses: ['deposit_pending'] },
]
const OPEN = new Set(OPEN_STAGES.flatMap((s) => s.statuses))
const ORDERED = new Set(['ordered', 'deposit_paid', 'scheduled', 'installed', 'done'])
const DEAD = new Set(['dead', 'lost', 'cancelled'])
/** 'open' | 'ordered' | 'dead' | 'other' (a status the app does not know) */
export function stageGroup(status) {
  if (OPEN.has(status)) return 'open'
  if (ORDERED.has(status)) return 'ordered'
  if (DEAD.has(status)) return 'dead'
  return 'other'
}
export const openStageOf = (status) => OPEN_STAGES.find((s) => s.statuses.includes(status))?.key || null

/**
 * Owner 10/16/26: leave out leads whose name has the WORD "test" (Test Lead, E2E test, jake-test, Test1,
 * TestLead, test_lead) - not names that merely contain it (Celeste, Contest, Attest, Testa, Testerman).
 */
export const isTestName = (name) => /(^|[^A-Za-z])[Tt][Ee][Ss][Tt](?![a-z])/.test(String(name || ''))
export const SAMPLE_NOTE = 'SAMPLE — safe to delete' // db/seed_sample_data.sql
/** Quote statuses that mean the customer bought (a sold quote's amount = the building's price). */
export const SOLD_QUOTE_STATUSES = new Set(['deposit_paid', 'revised', 'verbal_accept'])
/** The firm ones (a verbal accept is set by hand and is the weakest; it counts only when there is no firm one). */
const FIRM_SOLD = new Set(['deposit_paid', 'revised'])
/** A rep-logged follow-up (not the app's own entries: stage changes, quote saves, design notes). */
export const TOUCH_TYPES = ['call', 'email', 'meeting', 'note']
export const isRealTouch = (a) => !!a && TOUCH_TYPES.includes(a.type) && !!a.created_by && !a.kind
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const digits = (s) => String(s || '').replace(/\D/g, '')

/** One person per name: a re-created login with the same display name is the same rep. */
export function peopleOf(users) {
  const byName = new Map()
  const personOfUser = new Map()
  for (const u of users || []) {
    const name = String(u.display_name || u.email || 'Unnamed').trim()
    const k = name.toLowerCase()
    if (!byName.has(k)) byName.set(k, { key: k, name, ids: [] })
    byName.get(k).ids.push(u.id)
    personOfUser.set(u.id, k)
  }
  return { people: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), personOfUser }
}

// ── The numbers ─────────────────────────────────────────────────────────────────────────
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (a, b) => (b ? a / b : null)

/**
 * Everything the page shows, for period `p` (periodFor) with `today` (New York day) and `now` (ms).
 * data = { clients, quotes, touches, statusChanges, users, payments (null = not tracked yet), sampleIds }
 */
export function computePerformance(data, p, { today, now = Date.now() } = {}) {
  const users = data.users || []
  const { people, personOfUser } = peopleOf(users)
  const sampleIds = new Set(data.sampleIds || [])
  const personKey = (repId) => (repId && personOfUser.has(repId) ? personOfUser.get(repId) : 'unknown')

  // Leads: who counts
  const testLeads = []
  const clients = []
  for (const c of data.clients || []) {
    if (c.deleted_at) continue
    if (sampleIds.has(c.id)) continue
    if (isTestName(c.name)) { testLeads.push(c); continue }
    const inquiry = plainDay(c.first_contact_date) || nyDay(c.created_at)
    clients.push({ ...c, inquiry, entered: nyDay(c.created_at), group: stageGroup(c.status), person: personKey(c.primary_rep), order_day: plainDay(c.order_date) })
  }
  const byId = new Map(clients.map((c) => [c.id, c]))

  // Quotes with a price, on a counted lead
  const quotes = (data.quotes || [])
    .filter((q) => !q.deleted_at && byId.has(q.client_id) && num(q.total_amount) != null)
    .map((q) => ({ ...q, day: nyDay(q.created_at), total: num(q.total_amount) }))
  const quotesOf = new Map()
  for (const q of quotes) { if (!quotesOf.has(q.client_id)) quotesOf.set(q.client_id, []); quotesOf.get(q.client_id).push(q) }
  for (const list of quotesOf.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  // Follow-ups a rep logged, per lead (oldest first)
  const touches = (data.touches || []).filter((a) => isRealTouch(a) && byId.has(a.client_id))
  const touchesOf = new Map()
  for (const a of touches) { if (!touchesOf.has(a.client_id)) touchesOf.set(a.client_id, []); touchesOf.get(a.client_id).push(a) }
  for (const list of touchesOf.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  // Every quote on a counted lead, priced or not (a sold quote with no price must not fall back to a draft)
  const allQuotesOf = new Map()
  for (const q of data.quotes || []) {
    if (q.deleted_at || !byId.has(q.client_id) || q.status === 'superseded') continue
    if (!allQuotesOf.has(q.client_id)) allQuotesOf.set(q.client_id, [])
    allQuotesOf.get(q.client_id).push({ ...q, total: num(q.total_amount) })
  }
  for (const list of allQuotesOf.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  // Deposits received (022). Counted from the day tracking started (the first deposit entered, or one
  // dated earlier): before that, a week / month shows "n/a", never a made-up $0.
  const tracked = Array.isArray(data.payments)
  const deposits = tracked
    ? data.payments.filter((x) => !x.deleted_at && (x.kind || 'deposit') === 'deposit' && byId.has(x.client_id) && num(x.amount) != null).map((x) => ({ ...x, day: plainDay(x.received_on), amount: num(x.amount) }))
    : []
  let depositsSince = null
  if (tracked) {
    for (const x of data.payments) {
      for (const d of [nyDay(x.created_at), plainDay(x.received_on)]) if (d && (!depositsSince || d < depositsSince)) depositsSince = d
    }
    if (!depositsSince) depositsSince = today
  }
  const depositsKnown = (w) => tracked && !!depositsSince && w.to >= depositsSince

  /**
   * The building's price for a sold lead: its quote marked sold (Deposit Paid / Revised Order first,
   * a Verbal Accept only when there is none; the newest), else its starred quote, else its newest
   * priced quote. A sold quote with no price = amount unknown (never an old draft's price).
   */
  const saleAmount = (c) => {
    const all = allQuotesOf.get(c.id) || []
    const pick = (xs) => xs[xs.length - 1] || null
    const firm = all.filter((q) => FIRM_SOLD.has(q.status))
    const soldCount = all.filter((q) => SOLD_QUOTE_STATUSES.has(q.status)).length
    const sold = pick(firm) || pick(all.filter((q) => SOLD_QUOTE_STATUSES.has(q.status)))
    if (sold) return sold.total == null ? { amount: null, from: 'sold-unpriced', quote: sold, soldCount } : { amount: sold.total, from: 'sold', quote: sold, soldCount }
    const priced = all.filter((q) => q.total != null)
    const starred = pick(priced.filter((q) => q.starred))
    if (starred) return { amount: starred.total, from: 'starred', quote: starred, soldCount }
    const newest = pick(priced)
    if (newest) return { amount: newest.total, from: 'newest', quote: newest, soldCount }
    return { amount: null, from: null, quote: null, soldCount }
  }

  // One window of time (the period, or a trend column)
  const windowStats = (w) => {
    const leads = clients.filter((c) => inRange(c.inquiry, w))
    const qIn = quotes.filter((q) => inRange(q.day, w))
    const quoted = new Map() // client -> latest quote that window
    for (const q of qIn) { const cur = quoted.get(q.client_id); if (!cur || String(q.created_at) > String(cur.created_at)) quoted.set(q.client_id, q) }
    const sold = clients.filter((c) => c.group === 'ordered' && inRange(c.order_day, w)).map((c) => ({ c, sale: saleAmount(c) }))
    const dep = deposits.filter((x) => inRange(x.day, w))
    const soldAmounts = sold.map((s) => s.sale.amount).filter((v) => v != null)
    return {
      leadsIn: leads.length,
      leads,
      customersQuoted: quoted.size,
      quotesMade: qIn.length,
      revisions: qIn.filter((q) => q.parent_quote_id).length,
      quotedValue: [...quoted.values()].reduce((s, q) => s + q.total, 0),
      quoted,
      sold: sold.length,
      soldList: sold,
      soldValue: soldAmounts.reduce((s, v) => s + v, 0),
      soldNoAmount: sold.length - soldAmounts.length,
      deposits: depositsKnown(w) ? dep.reduce((s, x) => s + x.amount, 0) : null,
      depositCount: depositsKnown(w) ? dep.length : null,
      depositList: dep,
    }
  }

  const main = windowStats(p)
  // "N came in; the five weeks before averaged ..." - weeks only, and the same weekdays (this week so far
  // is Monday to today: compared with Monday to the same weekday of each of the 5 weeks before)
  const weekSpan = p.key === 'this_week' ? daysBetween(mondayOf(p.from), p.to) : 6
  const prevWeeks = p.key === 'this_week' || p.key === 'last_week'
    ? Array.from({ length: 5 }, (_, i) => { const from = addDays(mondayOf(p.from), -7 * (i + 1)); return { from, to: addDays(from, weekSpan) } })
    : []
  const prevAvgLeads = prevWeeks.length ? prevWeeks.reduce((s, w) => s + windowStats(w).leadsIn, 0) / prevWeeks.length : null
  const trend = trendBuckets(p).map((b) => {
    const s = windowStats(b)
    return { ...b, leadsIn: s.leadsIn, customersQuoted: s.customersQuoted, quotedValue: s.quotedValue, sold: s.sold, soldValue: s.soldValue, deposits: s.deposits }
  })

  // How the period's new leads were handled. The clock starts when the lead was entered; a lead
  // entered days after its first-contact date (backdated) cannot be timed and is counted apart.
  const firstTouch = (c) => (touchesOf.get(c.id) || []).find((a) => String(a.created_at) >= String(c.created_at)) || null
  const hours = []
  let followed = 0
  let within24 = 0
  let untimed = 0
  for (const c of main.leads) {
    const t = firstTouch(c)
    if (!t) continue
    followed++
    if (c.inquiry && c.entered && c.inquiry < c.entered) { untimed++; continue }
    const h = (new Date(t.created_at).getTime() - new Date(c.created_at).getTime()) / 3600000
    if (Number.isFinite(h)) { hours.push(h); if (h <= 24) within24++ }
  }
  const handling = { leads: main.leads.length, followed, followedPct: pct(followed, main.leads.length), medianHours: median(hours), within24, within24Pct: pct(within24, hours.length), timed: hours.length, untimed }

  // Close rate: of this period's new leads, how many are Ordered now
  const orderedNow = main.leads.filter((c) => c.group === 'ordered').length
  const closeRate = { ordered: orderedNow, of: main.leads.length, pct: pct(orderedNow, main.leads.length) }

  // Lost this period (a rep moved the lead to Dead)
  const lostIds = new Set((data.statusChanges || [])
    .filter((s) => s.created_by && DEAD.has(s.to) && byId.has(s.client_id) && inRange(nyDay(s.created_at), p))
    .map((s) => s.client_id))

  // Last follow-up (or the day it came in) for "no activity in 14+ days"
  const lastActivityDay = (c) => { const list = touchesOf.get(c.id); return list && list.length ? nyDay(list[list.length - 1].created_at) : c.entered }
  const quiet = (c) => c.group === 'open' && !!lastActivityDay(c) && daysBetween(lastActivityDay(c), today) >= 14

  // By rep (the lead's primary rep; follow-ups by the rep who logged them)
  const rows = new Map()
  const row = (k, name) => {
    if (!rows.has(k)) rows.set(k, { key: k, name, openNow: 0, newLeads: 0, followUps: 0, customersQuoted: 0, quotedValue: 0, sold: 0, soldValue: 0, deposits: 0, quiet: 0 })
    return rows.get(k)
  }
  for (const pp of people) row(pp.key, pp.name)
  const nameOf = (k) => (k === 'unknown' ? 'Unknown rep' : people.find((x) => x.key === k)?.name || 'Unknown rep')
  for (const c of clients) {
    const r = row(c.person, nameOf(c.person))
    if (c.group === 'open') r.openNow++
    if (quiet(c)) r.quiet++
  }
  for (const c of main.leads) row(c.person, nameOf(c.person)).newLeads++
  for (const a of touches) if (inRange(nyDay(a.created_at), p)) { const k = personKey(a.created_by); row(k, nameOf(k)).followUps++ }
  for (const [cid, q] of main.quoted) { const c = byId.get(cid); const r = row(c.person, nameOf(c.person)); r.customersQuoted++; r.quotedValue += q.total }
  for (const s of main.soldList) { const r = row(s.c.person, nameOf(s.c.person)); r.sold++; r.soldValue += s.sale.amount || 0 }
  for (const x of main.depositList) { const c = byId.get(x.client_id); row(c.person, nameOf(c.person)).deposits += x.amount }
  const reps = [...rows.values()].filter((r) => r.openNow || r.newLeads || r.followUps || r.customersQuoted || r.sold || r.deposits || r.quiet || people.some((pp) => pp.key === r.key))
  const totals = reps.reduce((t, r) => { for (const k of Object.keys(t)) t[k] += r[k]; return t }, { openNow: 0, newLeads: 0, followUps: 0, customersQuoted: 0, quotedValue: 0, sold: 0, soldValue: 0, deposits: 0, quiet: 0 })

  // Where the period's new leads came from
  const src = new Map()
  for (const c of main.leads) {
    const k = c.source || ''
    if (!src.has(k)) src.set(k, { source: k, leads: 0, quoted: 0, ordered: 0 })
    const s = src.get(k)
    s.leads++
    if ((quotesOf.get(c.id) || []).length) s.quoted++
    if (c.group === 'ordered') s.ordered++
  }
  const sources = [...src.values()].sort((a, b) => (a.source === '') - (b.source === '') || b.leads - a.leads)

  // The open pipeline right now
  const open = clients.filter((c) => c.group === 'open')
  const pipeline = OPEN_STAGES.map((s) => ({ key: s.key, label: s.label, count: open.filter((c) => s.statuses.includes(c.status)).length }))
  const ages = { d30: 0, d90: 0, d180: 0, older: 0, unknown: 0 }
  for (const c of open) {
    if (!c.inquiry) { ages.unknown++; continue }
    const age = daysBetween(c.inquiry, today)
    if (age <= 30) ages.d30++
    else if (age <= 90) ages.d90++
    else if (age <= 180) ages.d180++
    else ages.older++
  }

  // Numbers to check (each one can make a number above wrong)
  const orderedNoDate = clients.filter((c) => c.group === 'ordered' && !c.order_day)
  const soldFromOther = main.soldList.filter((s) => s.sale.from === 'starred' || s.sale.from === 'newest')
  const soldNoPrice = main.soldList.filter((s) => s.sale.from == null || s.sale.from === 'sold-unpriced')
  const multiSold = main.soldList.filter((s) => s.sale.soldCount > 1)
  const soldQuoteNotOrdered = clients.filter((c) => c.group !== 'ordered' && (allQuotesOf.get(c.id) || []).some((q) => FIRM_SOLD.has(q.status)))
  // "Pending Deposit" shows as Ordered elsewhere in the CRM; here it is open (not marked Ordered)
  const depositPending = clients.filter((c) => c.status === 'deposit_pending')
  const unknownStatus = clients.filter((c) => c.group === 'other')
  const noSource = main.leads.filter((c) => !c.source)
  const dupes = []
  const seen = new Map()
  for (const c of clients) {
    for (const key of [digits(c.phone).slice(-10), String(c.email || '').trim().toLowerCase()]) {
      if (!key || (key.length < 10 && !key.includes('@'))) continue
      if (seen.has(key) && seen.get(key).id !== c.id) {
        const other = seen.get(key)
        if ((inRange(c.inquiry, p) || inRange(other.inquiry, p)) && !dupes.some((d) => d.ids.includes(c.id) && d.ids.includes(other.id))) dupes.push({ ids: [other.id, c.id], names: [other.name, c.name], by: key.includes('@') ? 'email' : 'phone' })
      } else seen.set(key, c)
    }
  }
  const unknownRep = clients.filter((c) => c.person === 'unknown')

  return {
    period: p,
    generatedAt: now,
    tracked,
    depositsSince,
    main: { leadsIn: main.leadsIn, customersQuoted: main.customersQuoted, quotesMade: main.quotesMade, revisions: main.revisions, quotedValue: main.quotedValue, sold: main.sold, soldValue: main.soldValue, soldNoAmount: main.soldNoAmount, deposits: main.deposits, depositCount: main.depositCount, avgDeal: main.sold - main.soldNoAmount ? main.soldValue / (main.sold - main.soldNoAmount) : null, lost: lostIds.size },
    prevAvgLeads,
    closeRate,
    handling,
    trend,
    reps,
    totals,
    sources,
    pipeline,
    openTotal: open.length,
    ages,
    deals: main.soldList.map((s) => ({
      id: s.c.id, name: s.c.name, rep: nameOf(s.c.person), orderDay: s.c.order_day, amount: s.sale.amount, amountFrom: s.sale.from,
      quoteNumber: s.sale.quote?.quote_number || null,
      // every deposit on file for the lead, any date (the period's deposits are listed in depositRows)
      depositAll: deposits.filter((x) => x.client_id === s.c.id).reduce((t, x) => t + x.amount, 0),
      multiSold: s.sale.soldCount > 1,
    })).sort((a, b) => String(a.orderDay).localeCompare(String(b.orderDay))),
    depositRows: main.depositList.map((x) => ({ id: x.id, clientId: x.client_id, name: byId.get(x.client_id)?.name, day: x.day, amount: x.amount, method: x.method || null })).sort((a, b) => String(a.day).localeCompare(String(b.day))),
    checks: {
      orderedNoDate: orderedNoDate.map((c) => ({ id: c.id, name: c.name })),
      soldFromOther: soldFromOther.map((s) => ({ id: s.c.id, name: s.c.name, from: s.sale.from })),
      soldNoPrice: soldNoPrice.map((s) => ({ id: s.c.id, name: s.c.name, from: s.sale.from })),
      multiSold: multiSold.map((s) => ({ id: s.c.id, name: s.c.name, count: s.sale.soldCount })),
      depositPending: depositPending.map((c) => ({ id: c.id, name: c.name, ordered: !!c.order_day })),
      soldQuoteNotOrdered: soldQuoteNotOrdered.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      unknownStatus: unknownStatus.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      noSource: noSource.length,
      dupes,
      unknownRep: unknownRep.map((c) => ({ id: c.id, name: c.name })),
      testLeads: testLeads.map((c) => ({ id: c.id, name: c.name })),
    },
  }
}
