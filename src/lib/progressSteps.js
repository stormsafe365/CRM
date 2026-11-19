// The Activity & Progress stepper's rules (ActivityProgress.jsx), kept here so they can be tested.
//
// Owner 11/16/26 (Steve Coldwell): "it won't let me set it back to new lead - I made a quote but have not spoken to him
// yet". The status DID save as New Lead, but the stepper still ticked "Quote Sent" because any saved quote forced it,
// and "Lead Created" could not be clicked. Now the stepper follows the stage that is set (status / project_stage /
// payment_cleared) - a saved quote no longer forces "Quote Sent" - and clicking "Lead Created" sets the lead back to
// New Lead (Cold). Saving a quote still moves a New Lead to Working (promoteLead.js; owner kept that 11/16/26).

export const PROJ_ORDER = ['engineering', 'permitting', 'scheduling', 'installed']

export const STEP_LABELS = [
  'Lead Created', 'Attempting to Contact', 'Quote Sent', 'Contract Sent',
  'Contract Signed', 'Deposit Received', 'Engineering', 'Permitting',
  'Scheduling', 'Installed',
]

// How far down the linear stepper each sales status sits. Legacy/side values
// fold onto the nearest step so old rows still render sensibly.
export const STATUS_RANK = {
  new_lead: 0,
  contacted: 1,
  working: 2, quoted: 2, follow_up: 2, working_hot: 2, deposit_pending: 2,
  contract_sent: 3,
  ordered: 4,
}

// One linear rank for where the client actually is, derived from the SAME
// fields the stepper clicks write (status / project_stage / payment_cleared).
// This keeps click -> visible advance in lockstep: clicking a node writes the
// status, and the node then reads as done because its rank is reached.
export function reachedRank(client) {
  let rank = STATUS_RANK[client.status] ?? 1
  if (client.status === 'ordered') {
    rank = client.payment_cleared ? 5 : 4
    const idx = PROJ_ORDER.indexOf(client.project_stage)
    if (idx >= 0) rank = 6 + idx // engineering=6 ... installed=9
  }
  return rank
}

export function buildMilestones(client) {
  const rank = reachedRank(client)
  return STEP_LABELS.map((label, i) => ({ label, done: i <= rank }))
}

// Clicking a step moves the client to that milestone: the real status / project_stage fields, plus the
// lead-temperature gauge stop that matches (ClientDetail TEMP_TO_STATUS: cold = new_lead).
export const STEP_PATCH = [
  { status: 'new_lead', lead_temperature: 'cold' },                    // 0 Lead Created (back to New Lead)
  { status: 'contacted', lead_temperature: 'warm' },                   // 1 Attempting to Contact
  { status: 'working', lead_temperature: 'working' },                  // 2 Quote Sent -> Working Leads
  { status: 'contract_sent', lead_temperature: 'ready' },              // 3 Contract Sent
  { status: 'ordered' },                                               // 4 Contract Signed
  { status: 'ordered', payment_cleared: true },                        // 5 Deposit Received
  { status: 'ordered', project_stage: 'engineering' },                 // 6 Engineering
  { status: 'ordered', project_stage: 'permitting' },                  // 7 Permitting
  { status: 'ordered', project_stage: 'scheduling' },                  // 8 Scheduling
  { status: 'ordered', project_stage: 'installed' },                   // 9 Installed
]

// Owner 11/19/26 (Chris Farquharson): "this box shouldnt pop up until i click mark as ordered or click deposit cleared
// because he signed contract but were still waiting on the payment to clear". "Contract Signed" (step 4) only records the
// signature; the Mark-as-Ordered box (order date + Follow-Up HQ timeline, payment cleared) opens from "Deposit Received"
// (step 5 - always), and from a later step (Engineering ... Installed) only while no order details are saved.
export function stepOpensOrderBox(i, client) {
  if (i === 5) return true
  return i >= 6 && i < STEP_PATCH.length && !(client && client.order_date)
}
