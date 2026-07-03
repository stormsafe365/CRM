// Derive an ORDERED client's project stage from the Follow-Up HQ milestone store
// (ssfu_v8) — the furthest milestone checked off — falling back to the
// client-page stepper's clients.project_stage. Shared by the Dashboard "Project
// Stage" box and the Clients-list stage filter so the counts always agree.

import { followupsForClient } from './ssfuEngine'

const MS_ORDER = ['order', 'planinv', 'paid', 'plans', 'permit', 'site', 'sched', 'install', 'progress', 'complete']
const MS_TO_STAGE = {
  order: 'ordered', planinv: 'ordered', paid: 'ordered',
  plans: 'engineering', permit: 'permitting', site: 'permitting',
  sched: 'scheduling', install: 'installed', progress: 'installed', complete: 'installed',
}
function stepMilestone(f) {
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

export function derivedProjectStage(client, ssfu) {
  // Revisions is a manual, stepper-only stage — always honor it if set.
  if (client.project_stage === 'revisions_needed') return 'revisions_needed'
  if (ssfu) {
    let best = -1
    for (const f of followupsForClient(ssfu, client.id)) {
      if (!f.done) continue
      const idx = MS_ORDER.indexOf(stepMilestone(f))
      if (idx > best) best = idx
    }
    if (best >= 0) return MS_TO_STAGE[MS_ORDER[best]] || 'ordered'
  }
  return client.project_stage || 'ordered'
}
