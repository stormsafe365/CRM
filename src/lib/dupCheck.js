// dupCheck: find existing leads matching an email or phone before creating a
// new one — the guard against the same customer appearing twice in the
// pipeline. Matching is normalized (case-insensitive email, digits-only
// phone) so "(561) 555-0147" matches "5615550147".
import { supabase } from './supabase'

const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
const normEmail = (e) => String(e || '').trim().toLowerCase()

// Each match: { id, name, mine, repName, email?, phone? }. mine = false: another rep's lead (only its name
// and whose lead it is are known - migration 023's lead_already_exists, which looks across ALL leads).
export async function findDuplicateClients({ email, phone, excludeId = null }) {
  const em = normEmail(email)
  const ph = normPhone(phone)
  if (!em && !ph) return []
  const rpc = await supabase.rpc('lead_already_exists', { p_email: em || null, p_phone: ph || null, p_exclude: excludeId })
  if (!rpc.error && Array.isArray(rpc.data)) {
    return rpc.data.map((r) => ({ id: r.id, name: r.name, mine: r.mine !== false, repName: r.rep_name || 'another rep' }))
  }
  // before the 023 database update: every lead is visible, so look here
  const { data } = await supabase
    .from('clients')
    .select('id, name, email, phone, status')
    .limit(2000)
  return (data || []).map((c) => ({ ...c, mine: true })).filter((c) => {
    if (excludeId && c.id === excludeId) return false
    const cEm = normEmail(c.email)
    const cPh = normPhone(c.phone)
    return (em && cEm && cEm === em) || (ph && cPh && cPh === ph)
  })
}

export const dupSummary = (dups) =>
  dups.map((d) => (d.mine === false ? `${d.name || 'Unnamed'} (${d.repName}'s lead)` : `${d.name || 'Unnamed'} (${d.email || d.phone || 'on your list'})`)).join(', ')

/** A match on another rep's lead only: the rep cannot open it, so ask before making a second lead. */
export const othersOnly = (dups) => dups.length > 0 && dups.every((d) => d.mine === false)
export const othersText = (dups) =>
  `This customer is already a lead with another rep: ${dupSummary(dups)}.\n\nOK = make a new lead of your own anyway\nCancel = don't (ask your manager)`
