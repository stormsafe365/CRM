// closeAsk: what the builder asks before it closes (owner 11/2/26):
//   the X (top right; it replaced the Done button): "if changes were made and you press X a pop up box should appear
//   'continue without saving' so that way you cant really 'accidentally' hit it";
//   Done ▾ › Close without saving: "needs to then ask 'Are you sure?' before it'll close out without those changes made".
// -> null = close now (nothing to lose), or a check object for the one confirm dialog (PriceChangeConfirm).
//
// via:        'x' (asks only when something would be lost) | 'menu' (always asks)
// saved:      a saved quote is in hand (reopened, or saved in this session)
// check:      unsavedCheck() of that quote ({ dirty, priceMoved, saved, screen }), null when it could not be read
// hasBuild:   a quote not saved yet has a building in it (a width and a length)
//
// Plain JS (node-testable).

import { fmtMoney } from './priceLockCrm.js'

export function closeAsk({ via = 'x', quoteNumber = null, saved = false, check = null, hasBuild = false } = {}) {
  const q = quoteNumber ? `quote #${quoteNumber}` : 'this quote'
  let what = null
  if (saved) {
    if (check && check.dirty) {
      what = check.priceMoved && check.saved && check.screen
        ? `The price on screen is ${fmtMoney(check.screen.total)}; ${q} is saved at ${fmtMoney(check.saved.total)}.`
        : `The build on screen has changes that are not in ${q}.`
    }
  } else if (hasBuild) {
    what = 'This quote has not been saved to a lead yet.'
  }
  if (!what && via !== 'menu') return null
  return {
    confirm: true,
    changed: !!what, // something to lose: Go back is the default button
    title: via === 'menu' ? 'Are you sure?' : 'Continue without saving?',
    okLabel: 'Close without saving',
    okTone: 'danger', // orange outline: the safe choice (Go back) is the one that stands out
    cancelLabel: 'Go back',
    lines: [],
    notes: what
      ? [what, saved
          ? 'Closing now loses these changes. To keep them, go back and pick Done ▾ › Update this quote or Save as a new quote.'
          : 'Closing now loses this build. To keep it, go back and Save to Lead.']
      : [saved ? `Nothing has changed since ${q} was saved.` : 'Nothing has been built yet.'],
  }
}
