// ssfuEngine: a framework-agnostic mirror of the Follow-Up HQ milestone engine
// (public/follow-up-hq.html, the "milestone-driven follow-up engine" block).
// Lets the React client page toggle a milestone done/undone AND run the same
// gate-spawn chain the calendar runs — so checking "Confirm Invoice Paid" on a
// client's Order Timeline spawns the Plan Status step exactly as it would in
// Follow-Up HQ. Reads/writes the same localStorage key ('ssfu_v8'), so both
// surfaces stay in sync.
//
// ⚠️ This mirrors the calendar's inline engine. If you change the chain logic in
// follow-up-hq.html (PLAN_TYPES, the spawn functions, gate names), mirror it
// here too. Kept as a separate copy on purpose: the calendar is a standalone
// no-build HTML file in an iframe and can't import an ES module.

export const LS_KEY = 'ssfu_v8'

// ---- date helpers (identical to the calendar's toISO/parseISO/addDays/…) ----
const pad = (n) => String(n).padStart(2, '0')
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
const addWeeks = (iso, n) => addDays(iso, n * 7)
const addBiz = (iso, n) => { let d = parseISO(iso), a = 0; while (a < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) a++ } return toISO(d) }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const prettyDate = (iso) => { const d = parseISO(iso); return `${DOW[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}` }
export const todayISO = () => toISO(new Date())

const PLAN_TYPES = {
  none:            { label: 'No plans required',      earliest: null,        blurb: '' },
  masterfiles:     { label: 'Master files',           earliest: { biz: 5 },  blurb: 'Master files run ~5–7 business days.' },
  generic:         { label: 'Generic plans',          earliest: { days: 14 }, blurb: 'Generic plans run ~2–3 weeks.' },
  generic_stamped: { label: 'Generic stamped plans',  earliest: { days: 14 }, blurb: 'Generic stamped plans run ~2–3 weeks.' },
  sitespecific:    { label: 'Site-specific plans',    earliest: { days: 28 }, blurb: 'Site-specific plans run ~4–6 weeks.' },
  asbuilt:         { label: 'As-built stamped plans', earliest: { days: 28 }, blurb: 'As-built stamped plans run ~4–6 weeks.' },
  site:            { label: 'Site-specific plans',    earliest: { days: 28 }, blurb: 'Site-specific plans run ~4–6 weeks.' },
}
const FOUNDATION_DAYS = { 'Concrete': 21, 'Footers Only': 14, 'Asphalt': 10, 'Gravel': 7, 'Ground Install': 3, 'Directly to the ground': 3 }

const planEarliestDate = (from, planKey) => {
  const p = PLAN_TYPES[planKey]
  if (!p || !p.earliest) return null
  return p.earliest.biz ? addBiz(from, p.earliest.biz) : addDays(from, p.earliest.days)
}

// ---- localStorage I/O ----
export function readState() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!Array.isArray(s.followups)) s.followups = []
    if (!Array.isArray(s.clients)) s.clients = []
    return s
  } catch { return null }
}
function writeState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true } catch { return false }
}

// Match either the raw CRM uuid or the 'crm-'-prefixed id the calendar uses.
export function followupsForClient(state, clientId) {
  if (!state) return []
  const prefixed = `crm-${clientId}`
  return state.followups
    .filter(f => f.client === clientId || f.client === prefixed)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

// ---- engine (mirrors follow-up-hq.html) ----
const clientById = (state, id) => state.clients.find(c => c.id === id)
const fuExists = (state, client, gate) => state.followups.some(f => f.client === client && f.gate === gate)
const gateMet = (state, c, gate) => { const f = state.followups.find(x => x.client === c.id && x.gate === gate); return !!(f && f.done) }
function addFU(state, c, type, date, note, extra) {
  state.followups.push(Object.assign(
    { id: c.id + '-' + Math.random().toString(36).slice(2, 8), client: c.id, type, date, note, done: false, gen: true },
    extra || {}
  ))
}

function spawnPlanStatus(state, c, from) {
  if (fuExists(state, c.id, 'plans_received')) return
  const p = PLAN_TYPES[c.planKey] || PLAN_TYPES.generic
  const d = planEarliestDate(from, c.planKey) || addDays(from, 14)
  addFU(state, c, 'plans', d, `Plan Status — ${p.label}. ${p.blurb} Confirm status / that plans were received. ✓ this when plans are in.`, { gate: 'plans_received' })
}
function spawnAfterPlans(state, c, from) {
  const cty = c.county ? ` (${c.county} County)` : ''
  if (!c.exempt && !fuExists(state, c.id, 'permit_approved'))
    addFU(state, c, 'permit', addDays(from, 3), `Permit — submit & track the permit${cty}. Repeat every 14 days until approved. ✓ this when approved.`, { gate: 'permit_approved' })
  if (!c.siteReady && !fuExists(state, c.id, 'site_ready'))
    addFU(state, c, 'site', addDays(from, FOUNDATION_DAYS[c.foundation] || 7), `Site Prep — get the site ready${c.foundation ? ` (${c.foundation})` : ''}: grading, pad, inspections & access. Must be ready before scheduling. ✓ this when ready.`, { gate: 'site_ready' })
  checkSchedulingGate(state, c, from)
}
function checkSchedulingGate(state, c, from) {
  if (fuExists(state, c.id, 'scheduled')) return
  if (!c.exempt && !gateMet(state, c, 'permit_approved')) return
  if (!c.siteReady && !gateMet(state, c, 'site_ready')) return
  const [lo, hi] = String(c.bucket || '8-10').split('-').map(Number)
  const iStart = addWeeks(from, lo), iEnd = addWeeks(from, hi)
  addFU(state, c, 'install', from, 'Scheduling Request — site ready & permit cleared. Confirm the manufacturer has all approvals, request install scheduling, get the window.', { est: true, gate: 'scheduled' })
  addFU(state, c, 'install', iStart, `Installation — projected ${prettyDate(iStart)} – ${prettyDate(iEnd)} (${c.bucket || '8-10'} wk lead from scheduling). Confirm date, crew & access.`, { est: true })
  addFU(state, c, 'call', addDays(iStart, 6), 'Progress Check — install on schedule? Address any concerns; update the timeline if delayed.', { est: true })
  addFU(state, c, 'review', addDays(iEnd, 3), 'Completion — verify satisfaction, clear punch-list, request photos and/or a review.', { est: true })
}
function onGateDone(state, f, today) {
  const c = clientById(state, f.client)
  if (!c) return
  if (f.gate === 'invoice_paid') spawnPlanStatus(state, c, today)
  else if (f.gate === 'plans_received') spawnAfterPlans(state, c, today)
  else if (f.gate === 'permit_approved' || f.gate === 'site_ready') checkSchedulingGate(state, c, today)
}

// Wave 0 — seeded at order time (mirrors follow-up-hq.html seedWave0).
function seedWave0(state, c) {
  const o = c.ordered
  if (!o) return
  addFU(state, c, 'mfr', addBiz(o, 2), 'Order Confirmation — confirm the manufacturer received & entered the order (signed contract, deposit, specs, docs). Only chase if no acknowledgment has come in.')
  if ((c.planKey || 'none') === 'none') {
    spawnAfterPlans(state, c, o)
  } else {
    addFU(state, c, 'pay', addBiz(o, 5), 'Plan Invoice Issued? — confirm the manufacturer issued the plans invoice.')
    addFU(state, c, 'pay', addBiz(o, 7), 'Confirm Invoice Paid — verify the customer received & paid the plans invoice. Plans don’t start until it clears. ✓ this when paid.', { gate: 'invoice_paid' })
  }
}

// Build/refresh the calendar's client mirrors from live CRM clients and seed
// Wave 0 once per ordered client. Mirrors follow-up-hq.html mergeCrmClients,
// keyed by 'crm-<crmId>' so existing ssfu_v8 data + the client-portal Order
// Timeline stay matched. Returns the persisted state. crmClients items:
// { crmId, name, phone, city, county, building, value, rep, stage, ordered?,
//   mfr?, planKey?, bucket?, foundation?, permitting?, exempt?, siteReady? }.
export function syncFromCrm(crmClients) {
  const state = readState() || { followups: [], clients: [] }
  if (!Array.isArray(state.followups)) state.followups = []
  if (!Array.isArray(state.clients)) state.clients = []
  const ids = new Set((crmClients || []).map(c => c.crmId))
  state.clients = state.clients.filter(c => !c.crmId || ids.has(c.crmId)) // drop deleted leads
  for (const src of (crmClients || [])) {
    let c = state.clients.find(x => x.crmId === src.crmId)
    if (!c) { c = { id: 'crm-' + src.crmId, crmId: src.crmId }; state.clients.push(c) }
    c.name = src.name; c.phone = src.phone; c.city = src.city; c.county = src.county
    c.building = src.building; c.value = src.value; c.rep = src.rep; c.stage = src.stage
    if (src.ordered) {
      c.ordered = src.ordered; c.mfr = src.mfr; c.planKey = src.planKey; c.bucket = src.bucket
      c.foundation = src.foundation || null; c.permitting = src.permitting || null
      c.exempt = !!src.exempt; c.siteReady = !!src.siteReady
    }
  }
  // Seed Wave 0 once per ordered client — never auto-rebuild (would wipe progress).
  for (const c of state.clients) {
    if (c.crmId && c.ordered && !state.followups.some(f => f.client === c.id && f.gen)) seedWave0(state, c)
  }
  writeState(state)
  return state
}

// Toggle a follow-up done/undone, run gate-spawn on newly-done gates, persist.
// Returns the fresh follow-up list for this client (or null if it couldn't act).
export function toggleFollowupForClient(clientId, followupId) {
  const state = readState()
  if (!state) return null
  const f = state.followups.find(x => x.id === followupId)
  if (!f) return null
  f.done = !f.done
  if (f.done && f.gate) onGateDone(state, f, todayISO())
  writeState(state)
  return followupsForClient(state, clientId)
}

// Export the whole calendar store (clients + follow-ups) as JSON to share.
export function exportStateJSON() {
  const s = readState() || { clients: [], followups: [] }
  return JSON.stringify(s, null, 2)
}
// Import a previously-exported store, replacing the current one.
export function importStateJSON(text) {
  const s = JSON.parse(text)
  if (!s || !Array.isArray(s.followups) || !Array.isArray(s.clients)) throw new Error('Not a valid calendar export')
  writeState(s)
  return s
}

// Reschedule a follow-up (calendar drag / snooze). Persists to the shared store.
export function setFollowupDate(followupId, date) {
  const state = readState()
  if (!state) return false
  const f = state.followups.find(x => x.id === followupId)
  if (!f || !date) return false
  f.date = date
  writeState(state)
  return true
}
