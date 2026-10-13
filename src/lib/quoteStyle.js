// quoteStyle.js — the quote PDF's style (owner 10/12/26: "make the background
// white if someone wants, someone's asking because they need to print the quote
// but its background is too dark & taking up too much ink").
//
//   'dark'  — Dark (on-screen): the quote exactly as before (default)
//   'white' — White (print-friendly): the same pages on white with dark text
//
// The CRM and the embedded pricing program (public/build/quote-builder.html,
// same origin) share ONE choice: the program's localStorage key. The bar here,
// the program's own "Quote style" control and every quote PDF the CRM saves
// (capturePrintHtml → the program's printQuote) all follow it.

export const QUOTE_STYLE_KEY = 'ss_quote_style'

// short: the label on a narrower window (the bar also carries Finish Revision /
// Open in new tab / Done / Save), with the full wording kept in the tooltip.
export const QUOTE_STYLES = [
  { value: 'dark', label: 'Dark (on-screen)', short: 'Dark', title: 'Dark (on-screen): dark pages, as the quote looks on screen' },
  { value: 'white', label: 'White (print-friendly)', short: 'White', title: 'White (print-friendly): white pages with dark text — uses far less ink when printed' },
]

export function normalizeQuoteStyle(v) {
  return v === 'white' ? 'white' : 'dark'
}

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

// The rep's last choice; Dark when nothing (or something unknown) is stored.
export function readQuoteStyle(storage = defaultStorage()) {
  try { return normalizeQuoteStyle(storage ? storage.getItem(QUOTE_STYLE_KEY) : null) } catch { return 'dark' }
}

// Remember the choice and tell the program (when it is loaded) so its own
// control repaints at once. Returns the stored value.
export function writeQuoteStyle(v, { storage = defaultStorage(), program = null } = {}) {
  const s = normalizeQuoteStyle(v)
  try { if (storage) storage.setItem(QUOTE_STYLE_KEY, s) } catch { /* private mode: the program keeps it in memory */ }
  try { if (program && typeof program.setQuoteStyle === 'function') program.setQuoteStyle(s) } catch { /* older program */ }
  return s
}
