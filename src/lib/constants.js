// Constants that mirror the database. Keep in sync with db/migrations.
//
// Two tracks:
//   • CLIENT_STATUSES  — the SALES pipeline (New Lead → Ordered, plus Dead)
//   • PROJECT_STAGES   — kicks in once a client is "Ordered" (deposit paid +
//                        contract signed): Ordered → Installed, plus Revisions.

// ---- SALES pipeline (clients.status) ----
// Order matters — this is the funnel from first contact to order.
export const CLIENT_STATUSES = [
  { value: 'new_lead',      label: 'New Lead' },          // not yet contacted at all
  { value: 'contacted',     label: 'Attempting to Contact' }, // tried, no answer yet
  { value: 'working',       label: 'Working Leads' },     // spoken to / quoted
  { value: 'working_hot',   label: 'Working Hot Leads' }, // strong, likely to move soon
  { value: 'contract_sent', label: 'Contract Sent' },     // DocuSign out; awaiting deposit + signature
  { value: 'ordered',       label: 'Ordered' },           // deposit placed + contract signed
  { value: 'dead',          label: 'Dead' },              // not moving forward
]

// Once a client is 'ordered', this drives the project/fulfillment track.
export const PROJECT_STAGES = [
  { value: 'ordered',          label: 'Ordered' },
  { value: 'engineering',      label: 'Engineering' },
  { value: 'permitting',       label: 'Permitting' },
  { value: 'scheduling',       label: 'Scheduling' },
  { value: 'installed',        label: 'Installed' },
  { value: 'revisions_needed', label: 'Revisions Needed' },
]

// Convenience groupings used across the app (dashboard, filters).
// Legacy values (quoted/follow_up/lost/cancelled) are folded in so old rows
// still bucket correctly after the funnel rename.
export const SALES_OPEN_STATUSES = ['new_lead', 'contacted', 'working', 'working_hot', 'contract_sent', 'quoted', 'follow_up']
export const WORKING_STATUSES = ['working', 'working_hot', 'contract_sent', 'quoted', 'follow_up'] // actively being worked
export const DEAD_STATUSES = ['dead', 'lost', 'cancelled']

// Legacy status values from the original schema, kept so old rows still
// render a readable label even though they're no longer in the dropdown.
const LEGACY_STATUS_LABELS = {
  quoted: 'Working Leads',
  follow_up: 'Working Leads',
  lost: 'Dead',
  cancelled: 'Dead',
  deposit_pending: 'Ordered',
  deposit_paid: 'Ordered',
  scheduled: 'Ordered',
  installed: 'Ordered',
  done: 'Ordered',
}

export const LEAD_SOURCES = [
  { value: 'google_search',      label: 'Google Search' },
  { value: 'facebook',           label: 'Facebook' },
  { value: 'instagram',          label: 'Instagram' },
  { value: 'referral_customer',  label: 'Referral (Customer)' },
  { value: 'referral_partner',   label: 'Referral (Partner)' },
  { value: 'drive_by',           label: 'Drive-By / Saw Sign' },
  { value: 'event',              label: 'Event / Home Show' },
  { value: 'other',              label: 'Other' },
]

export const BUILDING_TYPES = [
  { value: 'residential',             label: 'Residential' },
  { value: 'risk_cat_2_residential',  label: 'Risk Cat 2 Residential' },
  { value: 'commercial',              label: 'Commercial' },
  { value: 'agricultural',            label: 'Agricultural' },
  { value: 'ag_exempt',               label: 'AG Exempt' },
]

export const QUOTE_STATUSES = [
  { value: 'draft',          label: 'Draft' },
  { value: 'sent',           label: 'Sent' },
  { value: 'verbal_accept',  label: 'Verbal Accept' },
  { value: 'deposit_paid',   label: 'Deposit Paid' },
  { value: 'declined',       label: 'Declined' },
  { value: 'superseded',     label: 'Superseded' },
  { value: 'expired',        label: 'Expired' },
]

// ---- label lookups ----
export const statusLabel = (value) =>
  CLIENT_STATUSES.find(s => s.value === value)?.label ?? LEGACY_STATUS_LABELS[value] ?? value

export const projectStageLabel = (value) =>
  PROJECT_STAGES.find(s => s.value === value)?.label ?? value

export const sourceLabel = (value) =>
  LEAD_SOURCES.find(s => s.value === value)?.label ?? value

export const buildingTypeLabel = (value) =>
  BUILDING_TYPES.find(b => b.value === value)?.label ?? value

export const quoteStatusLabel = (value) =>
  QUOTE_STATUSES.find(q => q.value === value)?.label ?? value

// ---- pill colors ----
export const statusColor = (status) => {
  const map = {
    new_lead:      { bg: '#16263a', fg: '#7dd3fc' }, // blue — fresh
    contacted:     { bg: '#16263a', fg: '#38bdf8' }, // blue — reaching out
    working:       { bg: '#2d2a1a', fg: '#fbbf24' }, // amber — in play
    working_hot:   { bg: '#2a1810', fg: '#fb7a3c' }, // hot orange — heating up
    contract_sent: { bg: '#1f2d1a', fg: '#9fc839' }, // lime — close
    ordered:       { bg: '#10241d', fg: '#43ffd2' }, // mint — won
    dead:          { bg: '#241a1c', fg: '#8b95a3' }, // muted — dead
    // legacy
    quoted:        { bg: '#2d2a1a', fg: '#fbbf24' },
    follow_up:     { bg: '#2d2a1a', fg: '#fbbf24' },
    lost:          { bg: '#241a1c', fg: '#8b95a3' },
    cancelled:     { bg: '#241a1c', fg: '#8b95a3' },
    deposit_paid:  { bg: '#10241d', fg: '#43ffd2' },
    scheduled:     { bg: '#10241d', fg: '#43ffd2' },
    installed:     { bg: '#10241d', fg: '#43ffd2' },
    done:          { bg: '#1a2d2d', fg: '#22d3ee' },
  }
  return map[status] ?? { bg: '#232b34', fg: '#8b95a3' }
}

export const projectStageColor = (stage) => {
  const map = {
    ordered:          { bg: '#10241d', fg: '#43ffd2' },
    engineering:      { bg: '#16263a', fg: '#00d9d9' },
    permitting:       { bg: '#2d2a1a', fg: '#fbbf24' },
    scheduling:       { bg: '#16263a', fg: '#38bdf8' },
    installed:        { bg: '#1a2d2d', fg: '#22d3ee' },
    revisions_needed: { bg: '#2a1f1a', fg: '#f6855e' },
  }
  return map[stage] ?? { bg: '#232b34', fg: '#8b95a3' }
}

export const quoteStatusColor = (status) => {
  const map = {
    draft:         { bg: '#232b34', fg: '#8b95a3' },
    sent:          { bg: '#16263a', fg: '#7dd3fc' },
    verbal_accept: { bg: '#2d2a1a', fg: '#fbbf24' },
    deposit_paid:  { bg: '#10241d', fg: '#43ffd2' },
    declined:      { bg: '#241a1c', fg: '#f87171' },
    superseded:    { bg: '#232b34', fg: '#8b95a3' },
    expired:       { bg: '#241a1c', fg: '#f87171' },
  }
  return map[status] ?? { bg: '#232b34', fg: '#8b95a3' }
}
