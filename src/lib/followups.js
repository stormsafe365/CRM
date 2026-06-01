// Date + cadence helpers for the follow-up engine.
// Everything is a 'yyyy-MM-dd' string to match clients.follow_up_date and the
// app's existing string-compare sorting (Dashboard/ClientsList). No time zones,
// no Date objects leaking out.

function toIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

export function isoToday() {
  return toIso(new Date())
}

export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso, n) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

export function addMonths(iso, n) {
  const d = parseIso(iso)
  d.setMonth(d.getMonth() + n)
  return toIso(d)
}

// b - a, in whole days (positive when b is later).
export function daysBetween(aIso, bIso) {
  return Math.round((parseIso(bIso) - parseIso(aIso)) / 86400000)
}

// How many days have passed since `iso` (positive = in the past).
export function daysSince(iso) {
  return daysBetween(iso, isoToday())
}

export function fmtLong(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// Calm, human "how long ago" — no counts that feel like a scoreboard.
export function agoLabel(iso) {
  if (!iso) return 'no contact yet'
  const n = daysSince(iso)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 7) return `${n} days ago`
  if (n < 14) return 'last week'
  if (n < 31) return `${Math.round(n / 7)} weeks ago`
  if (n < 61) return 'last month'
  return `${Math.round(n / 30)} months ago`
}

// The presets Jenna asked for. Each computes the next date from today.
export const FOLLOWUP_PRESETS = [
  { key: '3d', label: '+3 days', apply: () => addDays(isoToday(), 3) },
  { key: '2w', label: '+2 weeks', apply: () => addDays(isoToday(), 14) },
  { key: '1mo', label: '+1 month', apply: () => addMonths(isoToday(), 1) },
  { key: '6w', label: '+6 weeks', apply: () => addDays(isoToday(), 42) },
]

// Wider cadence used once a lead is flagged "cooling off" — gentle, not monthly.
export const COOLING_PRESETS = [
  { key: '6w', label: '+6 weeks', apply: () => addDays(isoToday(), 42) },
  { key: '2mo', label: '+2 months', apply: () => addMonths(isoToday(), 2) },
  { key: '3mo', label: '+3 months', apply: () => addMonths(isoToday(), 3) },
]

// Days of silence before an active order is gently flagged "needs an update".
export const STALE_ORDER_DAYS = 14
