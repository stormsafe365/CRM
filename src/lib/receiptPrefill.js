// receiptPrefill.js - what the Bill of Sale / Payment Receipt box starts with, so a signed contract's bill of sale needs
// no typing (owner 11/9/26, on Laura Rincon's signed agreement: "shouldnt i be able to generate bill of sale directly from
// signed contract & not have to manually fill anything in????"). The amounts come from the quote itself (orderTotalOf,
// receiptFreightOf, the saved deposit); this adds the contract's payment method and, from a signed contract, the day it
// was signed (the deposit is due at signing). Everything stays editable in the box.
import { signedOnOf } from './contractDocs.js'

// The contract's "Payment method (deposit)" options (quote-builder.html #ct-pay) are offered as they are, so the bill of sale
// says what the contract says.
export const RECEIPT_METHODS = ['Credit / Debit Card', 'ACH / Wire Transfer', 'ACH / Bank Transfer', 'Wire Transfer', 'Check', 'Cash', 'Financing', 'Other']
const CT_PAY = { 'Credit Card': 'Credit / Debit Card', 'ACH / Wire Transfer': 'ACH / Wire Transfer', Check: 'Check', Cash: 'Cash', Financing: 'Financing' }

/** The deposit payment method typed on the quote's contract page (payload_json.fields['ct-pay']), as a box option; null if none. */
export function contractPayMethod(q) {
  const v = q && q.payload_json && q.payload_json.fields && q.payload_json.fields['ct-pay']
  return (v && CT_PAY[v]) || null
}

/** { method, date } the box starts with. fromContract: the box was opened from a signed contract (Doc Hub) - its date is
 *  the day the contract was signed. today: 'YYYY-MM-DD'. */
export function receiptDefaults(q, { fromContract = false, today } = {}) {
  const signed = fromContract ? signedOnOf(q) : null
  return { method: contractPayMethod(q) || RECEIPT_METHODS[0], date: signed || today }
}
