// Post-quote follow-up cadence: when a lead is marked "Quote Sent", seed a
// sequence of reminder tasks for the rep to check in with the customer.
//
// Reminders only — each row sets remind_crm (a CRM reminder to the rep) and
// leaves email/SMS off, so NOTHING auto-sends to the customer. The rep sends
// the actual text/call. Rows land in the follow_ups table, so they surface in
// Upcoming Follow-Ups, the Today page, and Follow-Up HQ like any other task.

import { supabase } from './supabase'
import { isoToday, addDays } from './followups'

// Stored in each seeded row's `details` so we can (a) show the user the row was
// auto-added and (b) guard against seeding the same lead twice — no schema
// change required.
export const CADENCE_MARKER = 'post-quote follow-up sequence'

// The default rhythm. Every step is an editable/deletable follow-up row after
// seeding, so reps can tweak wording, timing, or channel per lead.
export const POST_QUOTE_CADENCE = [
  { offset: 3,  type: 'text', purpose: 'Confirm they received the quote + 3D rendering' },
  { offset: 7,  type: 'call', purpose: 'Follow up — any questions or changes needed?' },
  { offset: 21, type: 'text', purpose: 'Still planning to move forward? Happy to revise the quote.' },
  { offset: 42, type: 'call', purpose: 'Final check-in — lock in pricing before steel costs change' },
]

// Sales statuses at "Quote Sent" or beyond — the cadence only makes sense once
// a lead has actually been quoted.
export const QUOTED_PLUS = ['working', 'quoted', 'follow_up', 'working_hot', 'deposit_pending', 'contract_sent', 'ordered']

// Has this lead already had the cadence seeded? (detects the marker)
export async function cadenceSeeded(clientId) {
  const { data } = await supabase
    .from('follow_ups')
    .select('id, details')
    .eq('client_id', clientId)
  return (data ?? []).some(r => (r.details || '').includes(CADENCE_MARKER))
}

// Seed the cadence, dated from today. Self-guards against duplicates.
export async function seedPostQuoteCadence(client, userId) {
  if (!client?.id) return { seeded: false }
  if (await cadenceSeeded(client.id)) return { seeded: false, already: true }
  const today = isoToday()
  const rows = POST_QUOTE_CADENCE.map(s => ({
    client_id: client.id,
    audience: 'client',
    type: s.type,
    purpose: s.purpose,
    details: `Auto-added by the ${CADENCE_MARKER}.`,
    assigned_to: client.primary_rep ?? null,
    due_date: addDays(today, s.offset),
    due_time: null,
    remind_crm: true,
    remind_email: false,
    remind_sms: false,
    created_by: userId ?? null,
  }))
  const { error } = await supabase.from('follow_ups').insert(rows)
  if (error) return { seeded: false, error }
  return { seeded: true, count: rows.length }
}
