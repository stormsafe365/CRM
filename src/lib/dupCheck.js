// dupCheck: find existing leads matching an email or phone before creating a
// new one — the guard against the same customer appearing twice in the
// pipeline. Matching is normalized (case-insensitive email, digits-only
// phone) so "(561) 555-0147" matches "5615550147".
import { supabase } from './supabase'

const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
const normEmail = (e) => String(e || '').trim().toLowerCase()

export async function findDuplicateClients({ email, phone, excludeId = null }) {
  const em = normEmail(email)
  const ph = normPhone(phone)
  if (!em && !ph) return []
  const { data } = await supabase
    .from('clients')
    .select('id, name, email, phone, status')
    .limit(2000)
  return (data || []).filter((c) => {
    if (excludeId && c.id === excludeId) return false
    const cEm = normEmail(c.email)
    const cPh = normPhone(c.phone)
    return (em && cEm && cEm === em) || (ph && cPh && cPh === ph)
  })
}

export const dupSummary = (dups) =>
  dups.map((d) => `${d.name || 'Unnamed'} (${d.email || d.phone || 'no contact'})`).join(', ')
