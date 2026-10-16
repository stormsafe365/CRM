// Deposits received (owner 10/16/26): the order screen records each one (table payments, 022) so the
// Performance page counts real money in, by the day it came in.

export const DEPOSIT_METHODS = ['Check', 'Card', 'ACH / wire', 'Cash', 'Financing', 'Other']

/** "5100", "$5,100.50", " 5100.5 " -> 5100 / 5100.5; anything else (0, negative, letters, 3 decimals) -> null. */
export function parseDepositAmount(text) {
  const s = String(text ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const v = Number(s)
  return v > 0 && v < 10000000 ? v : null
}
