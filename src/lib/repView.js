// repView: what a sales rep (a NON-admin login, e.g. Lauren) sees vs. an admin (owner + Joshua).
// Owner 10/20/26: the rep sidebar and dashboard were far too much. This only shapes screens (the data lock
// is migration 023 row security). Admins are untouched: every entry, every page, today's dashboard.
// Pure functions - no React, no Supabase - so node --test can cover them.

// Sidebar entries in order. repHidden = removed for a rep; adminOnly = admins only (Trash).
export const NAV_META = [
  { to: '/dashboard',   label: 'Dashboard' },
  { to: '/clients',     label: 'Leads' },
  { to: '/designs',     label: 'Customer Designs', repHidden: true },
  { to: '/projects',    label: 'Projects', repHidden: true },
  { to: '/followups',   label: 'Follow-Ups' },
  { to: '/calendar',    label: 'Follow-Up HQ', repHidden: true },
  { to: '/pipeline',    label: 'Pipeline', repHidden: true },
  { to: '/quotes',      label: 'Quotes', repHidden: true },
  { to: '/documents',   label: 'Document Hub', repHidden: true },
  { to: '/build',       label: '3D Builder' },
  { to: '/layout',      label: '2D Layout', repHidden: true },
  { to: '/performance', label: 'Performance', repHidden: true }, // a rep's "My stats" is gone too
  { to: '/trash',       label: 'Trash', adminOnly: true },
]

/** isAdmin: true / false / null (checking) / 'error'. Only a definite false (a rep) loses entries, so an admin
 *  never sees a trimmed menu; Trash still needs a definite true (as before). */
export function visibleNav(items, isAdmin) {
  return items.filter((it) => {
    if (it.adminOnly && isAdmin !== true) return false
    if (it.repHidden && isAdmin === false) return false
    return true
  })
}

/** Pages a rep is soft-redirected away from if she types the URL. In-lead flows (/clients/:id, /build) are not here. */
export const REP_BLOCKED_PATHS = NAV_META.filter((it) => it.repHidden).map((it) => it.to)

export function isRepBlocked(isAdmin, path) {
  if (isAdmin !== false) return false
  return REP_BLOCKED_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

/** Links a rep must not see because the page behind them is removed for her (a definite rep only; an admin or a
 *  not-yet-known role keeps every link). Owner 10/20/26: no dead buttons. */
export function repHidesLink(isAdmin) {
  return isAdmin === false
}

/** Where a design notification opens. A rep has no Customer Designs page, so her many-designs ping opens Leads. */
export function designsPingTarget(isAdmin) {
  return repHidesLink(isAdmin) ? '/clients' : '/designs'
}

/**
 * Dashboard pieces per login (owner 10/20/26). Admin = today's full command center. A rep keeps the greeting
 * buttons, the four tiles ('Ordered · In Project' is relabelled 'Sold'), the Follow-Up Calendar, the QTE
 * Builder tile, and Needs Attention - no Quotes Sent chart, no 2D Layout tile, no Active Clients / Project
 * Stage / Follow-Ups Due Today boxes, no Sales Analytics.
 */
export function dashLayout(isRep) {
  return isRep
    ? { orderedLabel: 'Sold', tools: ['QTE Builder'], quotesSent: false, bottom: ['needsAttention'], analytics: false }
    : { orderedLabel: 'Ordered · In Project', tools: ['QTE Builder', '2D Layout'], quotesSent: true,
        bottom: ['activeClients', 'projectStage', 'dueToday', 'needsAttention'], analytics: true }
}
