// followupModel: adapts our milestone engine (ssfuEngine.js / ssfu_v8) into the
// data shape the redesigned Follow-Up HQ UI expects ({ clients, tasks } with
// derived coarse lane + milestone, plus the priority engine). One source of
// truth: the calendar and the client-portal Order Timeline both read/write the
// same store via ssfuEngine, so check-offs sync both ways.

import { syncFromCrm, followupsForClient, todayISO } from './ssfuEngine'

export const TODAY = todayISO()

/* ---- constants mirrored from the prototype's data.jsx ---- */
export const MILESTONES = [
  { id: 'order',    label: 'Order Conf.' },
  { id: 'planinv',  label: 'Plan Invoice' },
  { id: 'paid',     label: 'Invoice Paid' },
  { id: 'plans',    label: 'Plan Status' },
  { id: 'permit',   label: 'Permit' },
  { id: 'site',     label: 'Site Prep' },
  { id: 'sched',    label: 'Scheduling' },
  { id: 'install',  label: 'Installation' },
  { id: 'progress', label: 'Progress Check' },
  { id: 'complete', label: 'Completion' },
]
export const MILESTONE_IDX = Object.fromEntries(MILESTONES.map((m, i) => [m.id, i]))

export const LANES = [
  { id: 'plans',   label: 'Waiting on Plans',          icon: 'ruler',          accent: '#5A7CA0' },
  { id: 'permit',  label: 'Permitting',                icon: 'stamp',          accent: '#7C77A0' },
  { id: 'sched',   label: 'Scheduling / Awaiting Install', icon: 'calendar-clock', accent: '#2E8E86' },
  { id: 'install', label: 'Installed',                 icon: 'badge-check',    accent: '#4F9072' },
]
export const LANE_LABEL = Object.fromEntries(LANES.map(l => [l.id, l.label]))

export const CATS = {
  manufacturer: { id: 'manufacturer', label: 'Manufacturer', color: '#A8814A', tint: 'rgba(168,129,74,.13)' },
  invoice:      { id: 'invoice',      label: 'Invoice',      color: '#6B7A8E', tint: 'rgba(107,122,142,.13)' },
  plans:        { id: 'plans',        label: 'Plans',        color: '#5A7CA0', tint: 'rgba(90,124,160,.13)' },
  permit:       { id: 'permit',       label: 'Permit',       color: '#7C77A0', tint: 'rgba(124,119,160,.13)' },
  site:         { id: 'site',         label: 'Site Prep',    color: '#9A7B4A', tint: 'rgba(154,123,74,.13)' },
  install:      { id: 'install',      label: 'Install',      color: '#2E8E86', tint: 'rgba(46,142,134,.13)' },
  checkin:      { id: 'checkin',      label: 'Check-in',     color: '#4F9072', tint: 'rgba(79,144,114,.13)' },
  review:       { id: 'review',       label: 'Review',       color: '#0E7A76', tint: 'rgba(14,122,118,.13)' },
}
export const CAT_ORDER = ['manufacturer', 'plans', 'permit', 'install', 'review']

export const CHANNELS = {
  call:  { id: 'call',  label: 'Call',  verb: 'Call',  icon: 'phone' },
  email: { id: 'email', label: 'Email', verb: 'Email', icon: 'mail' },
  task:  { id: 'task',  label: 'Task',  verb: 'Log',   icon: 'clipboard-check' },
}

// our engine followup type → UI category / channel
const TYPE_CAT = { mfr: 'manufacturer', pay: 'invoice', plans: 'plans', permit: 'permit', site: 'site', install: 'install', call: 'checkin', review: 'review' }
const TYPE_CHANNEL = { mfr: 'call', pay: 'email', plans: 'call', permit: 'call', site: 'call', install: 'call', call: 'call', review: 'email' }

/* ---- date helpers (match the prototype) ---- */
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export function toISO(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function daysBetween(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000) }
export function daysOverdue(iso) { const d = -daysBetween(iso, TODAY); return d > 0 ? d : 0 }
export function relativeLabel(iso) {
  const diff = daysBetween(iso, TODAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return `in ${diff}d`
}
export function fmtDate(iso) { const d = parseISO(iso); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}` }
export function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const cells = []
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({ iso: toISO(dt), day: dt.getDate(), inMonth: dt.getMonth() === month, dow: dt.getDay() })
  }
  return cells
}
export const daysStuck = (c) => (c.milestone === 'complete' ? 0 : -daysBetween(c.ordered, TODAY))

/* ---- note → action/reason ("Order Confirmation — confirm the…") ---- */
function splitNote(note) {
  const s = String(note || '')
  const i = s.indexOf(' — ')
  return i > -1 ? { action: s.slice(0, i), reason: s.slice(i + 3) } : { action: s, reason: '' }
}
const STEP_MILESTONE = (f) => {
  if (f.type === 'mfr') return 'order'
  if (f.type === 'pay') return f.gate === 'invoice_paid' ? 'paid' : 'planinv'
  if (f.type === 'plans') return 'plans'
  if (f.type === 'permit') return 'permit'
  if (f.type === 'site') return 'site'
  if (f.type === 'install') return f.gate === 'scheduled' ? 'sched' : 'install'
  if (f.type === 'call') return 'progress'
  if (f.type === 'review') return 'complete'
  return 'order'
}
// Who the order is currently waiting on, per its furthest milestone — drives the
// "Waiting On" filter group.
const WAITING_ON = {
  order: 'manufacturer', planinv: 'manufacturer', paid: 'customer', plans: 'plans',
  permit: 'permit', site: 'customer', sched: 'scheduling', install: 'installation',
  progress: 'installation', complete: null,
}
function deriveProgress(fus) {
  // "current" milestone = the earliest still-open step (what they're working on
  // now), i.e. the lowest-index not-done follow-up. All done → complete.
  let milestone = 'order'
  if (fus.length) {
    const open = fus.filter(f => !f.done)
    if (!open.length) milestone = 'complete'
    else {
      let minIdx = 99
      for (const f of open) { const m = STEP_MILESTONE(f); const i = MILESTONE_IDX[m] ?? 0; if (i < minIdx) { minIdx = i; milestone = m } }
    }
  }
  // A client whose scheduling gate is checked but whose install hasn't happened
  // yet (milestone 'install' = awaiting the install) stays in the Scheduling /
  // Awaiting Install lane. The Installed lane is only for clients whose install
  // has actually occurred (progress check / completion).
  const lane = ['order', 'planinv', 'paid', 'plans'].includes(milestone) ? 'plans'
    : ['permit', 'site'].includes(milestone) ? 'permit'
    : (milestone === 'sched' || milestone === 'install') ? 'sched'
    : 'install' // progress, complete
  return { milestone, lane, waitingOn: WAITING_ON[milestone] ?? null }
}
function followupToTask(f, clientId) {
  const { action, reason } = splitNote(f.note)
  return {
    id: f.id, client: clientId, cat: TYPE_CAT[f.type] || 'manufacturer',
    channel: TYPE_CHANNEL[f.type] || 'call', date: f.date, done: !!f.done,
    action, reason, gate: f.gate || null,
  }
}

// Build { clients, tasks } for the UI from CRM-shaped clients (ordered ones only).
export function buildModel(crmClients) {
  const state = syncFromCrm(crmClients)
  const clients = [], tasks = []
  for (const src of (crmClients || [])) {
    if (!src.ordered) continue // the calendar tracks post-order work only
    const fus = followupsForClient(state, src.crmId)
    const { milestone, lane, waitingOn } = deriveProgress(fus)
    clients.push({
      id: src.crmId, name: src.name, city: src.city || '', county: src.county || '', phone: src.phone || '',
      rep: src.rep, building: src.building || '', sqft: src.sqft || '', wind: src.wind || '', model: src.model || src.mfr || '',
      mfr: src.mfr || '', value: src.value || 0, ordered: src.ordered, lane, milestone, waitingOn,
      responsiveness: 3, vip: !!src.vip, installDate: src.installDate || null, real: true,
    })
    for (const f of fus) tasks.push(followupToTask(f, src.crmId))
  }
  return { clients, tasks }
}

/* ---- priority engine (ported from the prototype's scoreTask) ---- */
export function scoreTask(task, client) {
  const c = client
  const f = []
  let s = 0
  const od = daysOverdue(task.date)
  if (od > 0) { const p = Math.min(30, od * 4); s += p; f.push({ label: `${od}d overdue`, pts: p }) }
  else if (task.date === TODAY) { s += 8; f.push({ label: 'Due today', pts: 8 }) }
  const vp = Math.round(Math.min(18, (c?.value || 0) / 7000))
  if (vp) { s += vp; f.push({ label: `$${((c?.value || 0) / 1000).toFixed(0)}k value`, pts: vp }) }
  if (c && c.responsiveness <= 2) { s += 10; f.push({ label: 'Low responsiveness', pts: 10 }) }
  if (c && task.cat === 'permit' && daysStuck(c) > 14) { s += 12; f.push({ label: 'Permit delay', pts: 12 }) }
  if (c && task.cat === 'manufacturer' && daysStuck(c) > 21) { s += 12; f.push({ label: 'Manufacturer delay', pts: 12 }) }
  if (c && c.installDate) {
    const di = daysBetween(c.installDate, TODAY)
    if (di >= 0 && di <= 5) { const p = 18 - di * 2; s += p; f.push({ label: `Install in ${di}d`, pts: p }) }
  }
  if (c && c.vip) { s += 8; f.push({ label: 'VIP', pts: 8 }) }
  if (task.cat === 'install' || task.cat === 'permit') { s += 4; f.push({ label: 'Storm season', pts: 4 }) }
  return { score: Math.min(100, Math.round(s)), factors: f.sort((a, b) => b.pts - a.pts) }
}
export function priorityBand(score) {
  if (score >= 55) return { id: 'critical', label: 'Critical', color: 'var(--storm-500)' }
  if (score >= 35) return { id: 'high', label: 'High', color: '#B0863F' }
  if (score >= 18) return { id: 'medium', label: 'Medium', color: 'var(--accent)' }
  return { id: 'low', label: 'Low', color: 'var(--ink-3)' }
}
