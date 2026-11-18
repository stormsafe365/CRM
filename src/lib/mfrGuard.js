// Manufacturer guard (owner 11/17/26, Steve Coldwell: "who i need to quote through CA - open edited his quote &
// duplicated, they change the manufacturer from CA to CCI").
//
// The quote program starts every NEW build on CCI (ACTIVE_MFR = 'CCI') and a build from a customer design is always
// CCI (lib/designToQuote: the design page is the CCI catalog). Nothing in the CRM compared that with the manufacturer
// the lead is set to (Lead > Manufacturer, clients.building_mfr) or with the manufacturer of the quote being edited /
// duplicated, so a lead meant for CA could be priced, saved and sent as CCI without anyone noticing.
//
// Now:
//   * a NEW quote on a lead set to CA or CCI opens the program on that manufacturer (startMfrFor);
//   * the builder bar always shows the manufacturer the program is pricing with, and a red bar when it differs from
//     the lead's manufacturer or from the quote that was opened (mfrMismatch), with one click to switch;
//   * saving (or any document write) while they differ asks first (mfrWriteCheck) - Cancel is the default.
// Pure helpers: no DOM, no Supabase (tests/mfrGuard.test.mjs).

export const MFR_NAME = { CA: 'Carports Anywhere (CA)', CCI: 'Carolina Carports (CCI)' }

// 'CA' | 'CCI' | null. Takes the program's ACTIVE_MFR, the quotes.manufacturer column ('ca' / 'cci' / 'other'),
// payload_json.mfr and the lead's building_mfr ('CCI' / 'CA' / 'SBSI' / 'MMM' - only CA and CCI price in the program).
export function normMfr(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase()
  if (s === 'CA' || s === 'CARPORTS ANYWHERE') return 'CA'
  if (s === 'CCI' || s === 'CAROLINA CARPORTS' || s === 'CAROLINA CARPORTS INC') return 'CCI'
  return null
}

// The manufacturer a quote row was saved with: its payload (what the program restores) first, then the card column.
export function quoteMfr(quote) {
  if (!quote || typeof quote !== 'object') return null
  const p = quote.payload_json
  return normMfr(p && typeof p === 'object' ? p.mfr : null) || normMfr(quote.manufacturer)
}

export function leadMfr(client) {
  return normMfr(client && typeof client === 'object' ? client.building_mfr : null)
}

// A NEW quote (nothing restored, not a customer design) on a lead set to CA / CCI starts on that manufacturer.
// Returns the manufacturer to switch the program to, or null (leave the program's own default).
export function startMfrFor({ client, restoring = false, fromDesign = false, programMfr = null } = {}) {
  if (restoring || fromDesign) return null
  const want = leadMfr(client)
  if (!want) return null
  return normMfr(programMfr) === want ? null : want
}

// What the program is pricing with vs what it should be. Returns [] when it agrees (or nothing is known), else one
// entry per disagreement: { against: 'lead' | 'quote', want, have, text }.
//   programMfr = window.ACTIVE_MFR of the program ('INPUT' manual pricing has no manufacturer: never flagged)
//   quote      = the quote that was opened / duplicated (its saved manufacturer), or null for a new quote
export function mfrMismatch({ programMfr, client = null, quote = null, inputMode = false } = {}) {
  const have = normMfr(programMfr)
  if (!have || inputMode) return []
  const out = []
  const ld = leadMfr(client)
  if (ld && ld !== have) {
    out.push({ against: 'lead', want: ld, have,
      text: `${client && client.name ? client.name : 'This lead'} is set to ${ld} (Lead › Manufacturer), but this quote is priced as ${have}.` })
  }
  const qm = quoteMfr(quote)
  if (qm && qm !== have && qm !== ld) {
    out.push({ against: 'quote', want: qm, have,
      text: `${quote && quote.quote_number ? `Quote #${quote.quote_number}` : 'The quote you opened'} was saved as ${qm}, but the program is now pricing it as ${have}.` })
  }
  return out
}

// The one manufacturer to offer in "Switch to …" (the lead's wins: it is what the owner set for the customer).
export function switchTarget(mismatches) {
  const list = Array.isArray(mismatches) ? mismatches : []
  const lead = list.find((m) => m.against === 'lead')
  return (lead || list[0] || {}).want || null
}

// The confirm dialog (PriceChangeConfirm) shown before a write while the manufacturer disagrees, or null.
// kind: 'save' | 'contract' | 'exec' | 'revision' | 'new'
export function mfrWriteCheck({ kind = 'save', mismatches = [] } = {}) {
  const list = Array.isArray(mismatches) ? mismatches : []
  if (!list.length) return null
  const have = list[0].have
  const want = switchTarget(list)
  const what = kind === 'contract' ? 'generate this contract' : kind === 'exec' ? 'make this executed copy'
    : kind === 'revision' ? 'save this revision' : kind === 'new' ? 'save this as a new quote' : 'save this quote'
  return {
    title: `Manufacturer check — this quote is priced as ${have}`,
    lines: [],
    changed: true,
    notes: [
      ...list.map((m) => m.text),
      `Cancel, then click “Switch to ${want}” in the red bar (or pick ${want} in the program’s manufacturer box) to price it as ${want}.`,
      `Only continue if this customer really is being quoted through ${have}.`,
    ],
    okLabel: `Yes — ${what} as ${have}`,
    cancelLabel: 'Cancel',
    okTone: 'danger',
  }
}
