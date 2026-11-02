// builderTrim: the buttons at the end of the program's quote summary, inside the CRM (owner 11/2/26: "There are too many options
// at the end of view quote summary ... It should only really be Save/Print PDF, Generate Contract, Use AS Revision"):
//   Executed Copy — Deposit Paid  -> the quote card's Documents ▾ menu has it
//   Reset Form                    -> not wanted there
//   Revised Layout                -> "remove ... entirely since we have use as revision already"
//   Send Design Link              -> the quote card's link button makes it
// Hidden in the CRM only (the program itself, in the standalone app / NEWTOOL, keeps them). Plain JS (node-testable).

export const HIDE_IN_CRM = ['EXECUTED COPY', 'RESET FORM', 'REVISED LAYOUT', 'SEND DESIGN LINK']

/** Hide those buttons in the program's summary button row. Returns how many it hid this time (0 = nothing left to do). */
export function trimProgramButtons(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return 0
  let n = 0
  for (const b of doc.querySelectorAll('.desktop-btns button')) {
    const t = String(b.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase()
    if (!HIDE_IN_CRM.some((h) => t.startsWith(h))) continue
    if (b.style.display === 'none') continue
    b.style.display = 'none'
    try { b.dataset.ssCrmHidden = '1' } catch { /* ignore */ }
    n++
  }
  return n
}
