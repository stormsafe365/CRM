// saveAsNew.js — "Save as a new quote" in the Build Quote modal (owner 10/24/26: she tweaked a saved quote and
// wanted to keep BOTH versions, but the only save overwrote the original).
//
// The rule: the tweaked build becomes a NEW quote row for the same lead and the original row is never written.
// A new quote is priced like any brand-new quote (owner 9/30/26: "if i click duplicate or new quote then yes
// pricing should be up-to date"), so before it is saved the program drops every "as sold" state of the quote it
// reopened — the held price, grandfathered / overridden rules, rule decisions, a pinned deposit % — with its own
// PriceLock.freshen() (the same step a Duplicate of an older quote uses), and the saved total is exactly what the
// program shows after that. It never carries the original's price, price history, contract-sent / signed marks
// or revision links; payload_json.duplicatedFrom names the original (Use as Revision preselects it).
//
// Pure functions + two small program-window helpers (self-contained, so a test can run them in the real program).
// Unit tests: tests/saveAsNew.test.mjs

import { lockTarget, planQuoteFields, savedTotalsOf, totalsDiffer, fmtMoney, fmtDelta, r2 } from './priceLockCrm.js'
import { CRM_PAYLOAD_KEYS } from './contractDocs.js'

// Builder fields that carry a held / signed price. A new quote never has them.
export const AS_SOLD_FIELDS = ['hold-amt', 'hold-ref', 'hold-src', 'hold-dec', 'ct-honor', 'ct-honor-ref']
// payload_json keys that belong to the ORIGINAL quote only (contract sent / signed / revision links, its price
// history, a duplicate's fresh-pricing markers).
const ORIGINAL_ONLY = [...CRM_PAYLOAD_KEYS, 'price_history', 'duplicatedFrom', 'priceFresh', 'freshBasis']
// quotes columns a new row never takes from anywhere
const ROW_DROP = ['id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'parent_quote_id', 'starred']

export const QUOTE_NUMBER_RE = /^SS-\d{4}-\d{5}$/

// A new quote number, same format as a Duplicate (QuotesTab.handleDuplicate) and the program's printed quote:
// SS-<year>-<last 5 digits of the clock>. Never one of `avoid` (the original's number).
export function newQuoteNumber(now = new Date(), avoid = []) {
  const skip = new Set((avoid || []).filter(Boolean).map(String))
  let t = now.getTime()
  for (let i = 0; i < 100000; i++, t++) {
    const n = `SS-${now.getFullYear()}-${String(t).slice(-5)}`
    if (!skip.has(n)) return n
  }
  throw new Error('Could not make a new quote number.')
}

const numOr0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const filled = (v) => v != null && String(v).trim() !== ''

// Why "Save as a new quote" is not offered right now, or null.
//  - during a revision (Apply to Building → Finish Revision): that flow saves THIS order; a second row in the
//    middle of it would split the revision across two quotes
//  - a quote with Pricing-tab price edits (payload_json.sessionEdits): the program's tables carry them and a new
//    quote must start from the standard tables (a Duplicate drops them the same way)
export function saveAsNewBlocker({ original = null, revisionChanges = null } = {}) {
  if (!original || !original.id) return 'Save this quote first (Save to Lead).'
  if (revisionChanges) return 'Not during a revision — Finish Revision saves this order. Close, then use Duplicate on the quote card.'
  const se = original.payload_json && original.payload_json.sessionEdits
  if (Array.isArray(se) && se.length) return 'This quote has Pricing-tab price edits, and a new quote starts from the standard price tables. Use Duplicate on the quote card instead.'
  return null
}

// What in a harvested payload_json still belongs to the original's held / signed price ([] = none).
export function saveAsNewProblems(pj) {
  const out = []
  const f = (pj && pj.fields) || {}
  if (Math.abs(numOr0(f['hold-amt'])) >= 0.005 || filled(f['hold-ref']) || filled(f['hold-src'])) out.push('the program still holds the original’s saved price')
  if (filled(f['hold-dec'])) out.push('the original’s rule decisions are still applied')
  if (numOr0(f['ct-honor']) > 0) out.push('Honor Signed Pricing is still set')
  const pr = pj && pj.priced
  if (pr && (pr.source === 'held' || Math.abs(numOr0(pr.hold)) >= 0.005 || (Array.isArray(pr.holdParts) && pr.holdParts.length))) out.push('the price snapshot is still the held price')
  const g = pj && pj.overrides && pj.overrides.grand
  if (g && Object.keys(g).some((k) => g[k] === true)) out.push('a grandfathered rule is still applied')
  return out
}

// The quotes row to INSERT for "Save as a new quote".
//  payload  = what lib/builderSave harvestAndSaveQuote builds for a brand-new quote (initialQuote: null): the
//             program's on-screen totals, collectQuoteData + PriceLock.snapshot(), the new quote PDF path
//  original = the quote the builder was editing (left untouched; only its id / number are read)
// Throws when the payload still carries the original's held price (nothing must be inserted then).
export function saveAsNewRow({ payload, original = null, clientId, userId = null, now = new Date() } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Nothing to save.')
  if (!clientId) throw new Error('Pick a lead first (Save to Lead).')
  const total = Number(payload.total_amount)
  if (!Number.isFinite(total) || total <= 0) throw new Error('No price yet — set a width, length and height first.')
  const pj0 = payload.payload_json && typeof payload.payload_json === 'object' ? payload.payload_json : {}
  const problems = saveAsNewProblems(pj0)
  if (problems.length) throw new Error(`Not saved as a new quote: ${problems.join('; ')}. Close and reopen the quote, then try again.`)

  const pj = { ...pj0 }
  ORIGINAL_ONLY.forEach((k) => { delete pj[k] })
  const fields = { ...(pj.fields || {}) }
  AS_SOLD_FIELDS.forEach((k) => { delete fields[k] })
  pj.fields = fields
  // first priced NOW (the program carries the reopened quote's first-priced day in its snapshot)
  if (pj.priced && typeof pj.priced === 'object') pj.priced = { ...pj.priced, firstPricedAt: pj.priced.pricedAt || now.toISOString() }

  const origNo = original && original.quote_number ? String(original.quote_number) : null
  const quote_number = QUOTE_NUMBER_RE.test(String(payload.quote_number || '')) && payload.quote_number !== origNo
    ? payload.quote_number
    : newQuoteNumber(now, [origNo])
  pj.quote_number = quote_number
  pj.duplicatedFrom = { id: (original && original.id) || null, quote_number: origNo, at: now.toISOString(), via: 'save-as-new' }

  const row = { ...payload }
  ROW_DROP.forEach((k) => { delete row[k] })
  return {
    ...row,
    quote_date: payload.quote_date || now.toISOString().slice(0, 10),
    quote_number,
    ...planQuoteFields({ initialQuote: null, now }), // draft, valid 30 days, no notes — a brand-new quote
    pdf_snapshot_url: payload.pdf_snapshot_url || null,
    payload_json: pj,
    client_id: clientId,
    created_by: userId || null,
    // one starred quote per lead: a new quote starts unstarred (only where the column exists, like a Duplicate)
    ...(original && Object.prototype.hasOwnProperty.call(original, 'starred') ? { starred: false } : {}),
  }
}

// The confirm dialog (PriceChangeConfirm) when switching the build to today's pricing moved the price on screen.
// Lines: the ORIGINAL quote's saved totals → the new quote's.
export function saveAsNewConfirm({ original = null, before = null, after = null } = {}) {
  const saved = savedTotalsOf(original)
  const num = original && original.quote_number ? `#${original.quote_number}` : 'the original quote'
  const lines = saved && after ? [
    { label: 'Total', from: saved.total, to: after.total, delta: r2(after.total - saved.total) },
    { label: 'Deposit', from: saved.deposit, to: after.deposit, delta: r2(after.deposit - saved.deposit) },
    { label: 'Balance', from: saved.balance, to: after.balance, delta: r2(after.balance - saved.balance) },
  ] : []
  const notes = []
  if (before && after && totalsDiffer(before, after)) {
    notes.push(`A new quote is priced at today’s pricing: the price held on screen was ${fmtMoney(before.total)}, today’s pricing for this build is ${fmtMoney(after.total)} (${fmtDelta(after.total - before.total)}).`)
  }
  notes.push(`${num} stays exactly as it is${saved ? ` (${fmtMoney(saved.total)})` : ''}. The new quote gets its own number, today’s date and a new quote PDF.`)
  notes.push('Nothing is saved if you cancel — the builder keeps showing today’s pricing; close and reopen the quote to see its held price again.')
  return { confirm: true, changed: true, title: 'Save as a new quote at today’s pricing?', okLabel: 'Save as new quote', lines, notes }
}

// ── Unsaved changes (Done) ────────────────────────────────────────────────
// The build as the program reads it, minus what changes by itself (the save time stamp).
export function buildSignature(data) {
  if (!data || typeof data !== 'object') return null
  const { savedAt, priced, ...rest } = data
  try { return JSON.stringify(rest) } catch { return null }
}
// dirty = the price on screen is not the saved quote's (the held target on an honored sold order), or the build
// differs from the one read right after it was opened / last saved (baseline).
export function unsavedCheck({ baseline = null, sig = null, saved = null, screen = null, lock = null } = {}) {
  const target = saved ? lockTarget({ saved, lock }).target : null
  const priceMoved = !!(target && screen && totalsDiffer(target, screen))
  const buildChanged = !!(baseline && sig && baseline !== sig)
  return { dirty: priceMoved || buildChanged, priceMoved, buildChanged, saved: target, screen }
}
export function unsavedMessage({ quoteNumber = null, check }) {
  const q = quoteNumber ? `quote #${quoteNumber}` : 'this quote'
  const what = check.priceMoved && check.saved && check.screen
    ? `the price on screen is ${fmtMoney(check.screen.total)}, ${q} is saved at ${fmtMoney(check.saved.total)}`
    : `the build on screen has changes that are not in ${q}`
  return `Close without saving? ${what[0].toUpperCase()}${what.slice(1)}.\n\nOK = close and lose these changes.\nCancel = go back (Update Quote, or ▾ Save as a new quote to keep both).`
}

// ── In the program window (self-contained: no imports, so a test can inject them into the real program) ──
// Put the program on a brand-new quote's footing before "Save as a new quote": Honor Signed Pricing cleared,
// then PriceLock.freshen() — no held price, every current rule applied (no grandfathered / overridden rules,
// no rule decisions), the session's own deposit % and free-upgrade threshold. Only when a quote was reopened
// (PriceLock.st exists); a build that was never reopened has nothing held. Returns the on-screen totals before
// and after.
export function prepareProgramForNewQuote(pg) {
  const money = (id) => {
    try {
      const el = pg.document.getElementById(id)
      const t = el ? String(el.textContent || '') : ''
      const n = Number(t.replace(/[^0-9.]/g, ''))
      if (!t.trim() || !Number.isFinite(n)) return null
      return /^\s*[-−]/.test(t) ? -n : n
    } catch { return null }
  }
  const screen = () => { const total = money('ptot'); return total ? { total, deposit: money('pdep') || 0, balance: money('pbal') || 0 } : null }
  const before = screen()
  let honored = false
  try {
    ;['ct-honor', 'ct-honor-ref'].forEach((id) => { const el = pg.document.getElementById(id); if (el && String(el.value || '').trim() !== '') { el.value = ''; honored = true } })
  } catch { /* no contract section */ }
  const PL = pg.PriceLock
  let freshened = false
  if (PL && PL.st && typeof PL.freshen === 'function') {
    try { freshened = PL.freshen() !== false } catch (e) { return { ok: false, reason: 'the program could not switch to today’s pricing (' + ((e && e.message) || e) + ')', before, after: screen() } }
  } else if (honored) {
    try { if (typeof pg.rc === 'function') pg.rc() } catch { /* priced below */ }
  }
  return { ok: true, before, after: screen(), freshened, honored }
}
// After the new row is saved: the builder is on the NEW quote, so the revision baseline of the quote it reopened
// ("as ordered" totals + marks) goes, exactly as a quote load clears it — a later contract of the new quote is a
// normal contract, never a "revised" one against the original.
export function finishProgramForNewQuote(pg) {
  try { if (typeof pg._rvClear === 'function') { pg._rvClear(); return true } } catch { /* ignore */ }
  return false
}
