// promoteToWorking: saving a quote means the lead has been quoted, so move it to
// "Working Leads" — the same status the Activity & Progress "Quote Sent" step
// writes. Only ever moves a lead FORWARD: clients already past this point
// (working, hot, contract sent, ordered…) and dead leads are left untouched.
import { supabase } from './supabase'

const EARLY = ['new_lead', 'contacted']

export async function promoteToWorking(clientId, userId = null) {
  if (!clientId) return false
  const { data: c, error: readErr } = await supabase
    .from('clients')
    .select('status')
    .eq('id', clientId)
    .single()
  if (readErr || !c || !EARLY.includes(c.status)) return false
  const { error } = await supabase
    .from('clients')
    .update({
      status: 'working',
      lead_temperature: 'working',
      lead_temp_updated_at: new Date().toISOString(),
      lead_temp_updated_by: userId,
    })
    .eq('id', clientId)
    .in('status', EARLY) // guard against a concurrent move past "working"
  return !error
}
