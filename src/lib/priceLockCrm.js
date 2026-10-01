// priceLockCrm.js — CRM side of the reopened-quote price lock (owner 9/30/26:
// "make sure i can reopen that quote exactly as it was").
//
// The builder (quote-builder.html, window.PriceLock) holds a reopened quote at
// its SAVED price. This file is the CRM's half: which options to reopen with,
// when an automatic contract / executed copy / revision may run, what the
// confirm dialog shows before a write, how a re-save keeps status / notes /
// price history, and how a duplicate starts fresh.
//
// Pure functions only — no React, no Supabase, no DOM beyond reading the
// program window that is passed in — so they are unit-tested in node
// (tests/priceLockCrm.test.mjs).

export const SOLD_STATUSES = ['verbal_accept', 'deposit_paid', 'revised']
export const isSold = (status) => SOLD_STATUSES.includes(status)

// Most recent price-history entries that keep a full copy of the replaced
// build config (older entries keep the money + PDF path only).
export const HISTORY_PAYLOAD_KEEP = 5
export const HISTORY_MAX = 100

// Hidden builder fields that carry a quote's held price. A duplicate must not
// inherit them (it is priced fresh).
const HOLD_FIELDS = ['hold-amt', 'hold-ref', 'hold-src', 'hold-dec']

// ── Money ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100
export const sameCents = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005

export function fmtMoney(n) {
  const v = r2(n)
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '−$' : '$') + s
}
export function fmtDelta(n) {
  const v = r2(n)
  if (!v) return '$0.00'
  return (v > 0 ? '+' : '') + fmtMoney(v)
}

// {total, deposit, balance} from a quotes row, or null when it has no total.
export function savedTotalsOf(quote) {
  if (!quote) return null
  const total = num(quote.total_amount)
  if (total == null) return null
  return { total, deposit: num(quote.deposit_amount) ?? 0, balance: num(quote.balance_amount) ?? 0 }
}

// True when any of total / deposit / balance differ by a cent or more.
// A missing side counts as different only when the other side has a total.
export function totalsDiffer(a, b) {
  if (!a && !b) return false
  if (!a || !b) return true
  return !(sameCents(a.total, b.total) && sameCents(a.deposit, b.deposit) && sameCents(a.balance, b.balance))
}

// ── Reading the builder program window (never throws) ─────────────────────
function parseMoney(text) {
  if (text == null) return null
  const t = String(text)
  const n = Number(t.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return null
  return /^\s*[-−]/.test(t) ? -n : n
}
export function readScreenTotals(pg) {
  try {
    const G = pg && pg.G
    if (typeof G !== 'function') return null
    const total = parseMoney(G('ptot')?.textContent)
    if (!total) return null
    return { total, deposit: parseMoney(G('pdep')?.textContent) ?? 0, balance: parseMoney(G('pbal')?.textContent) ?? 0 }
  } catch { return null }
}
// The builder's lock object is window.PriceLock (window.PL is the plan-labels
// table — a different thing). Returns PriceLock.state() or null.
export function readLockState(pg) {
  try {
    const L = pg && pg.PriceLock
    if (!L || typeof L.state !== 'function') return null
    return L.state() || null
  } catch { return null }
}

// The quote PDF's "Building Amount" (printQuote's subtotal) from the captured
// print HTML, or null. Saved next to the price snapshot so a quote whose PDF
// and on-screen subtotal disagree (known path divergences, e.g. fslean) is
// visible later instead of silent.
export function printedBuildingAmount(html) {
  if (!html) return null
  const text = String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(/Building Amount\s*\$\s*([\d,]+(?:\.\d{1,2})?)/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
export function withPrintCheck(priced, html) {
  if (!priced || typeof priced !== 'object') return priced
  const printSub = printedBuildingAmount(html)
  if (printSub == null || !Number.isFinite(Number(priced.sub))) return priced
  const diverged = Math.abs(printSub - Number(priced.sub)) >= 0.01
  return { ...priced, printSub, ...(diverged ? { printDiverged: true } : {}) }
}

// ── Reopen options ────────────────────────────────────────────────────────
export function isBuilderPayload(p) {
  return !!(p && (p.fields || p.source === '3d-builder'))
}
// {total, deposit, balance} from a duplicate's freshBasis, or null.
function freshBasisOf(b) {
  const total = num(b && b.total)
  if (total == null || total <= 0) return null
  return { total, deposit: num(b.deposit) ?? 0, balance: num(b.balance) ?? 0 }
}
// Options for restoreQuoteData(data, opts), or null to reopen at today's
// pricing (no saved price to hold: a fresh duplicate, or a quote with no total).
// A duplicate of an older quote (freshBasis) opens with {fresh:true}: the
// builder reads the original's card totals only to recover the build (roof
// style, free 26GA), then prices the copy like a brand-new quote
// (PriceLock.freshen; its lock state then reads requested:false).
export function restoreOptionsFor(quote) {
  const p = quote?.payload_json
  if (!p || !p.fields) return null
  if (p.priceFresh) {
    const basis = !p.priced ? freshBasisOf(p.freshBasis) : null
    return basis ? { lock: true, fresh: true, status: quote.status || 'draft', legacyTotals: basis } : null
  }
  const status = quote.status || ''
  if (p.priced) return { lock: true, status }
  const saved = savedTotalsOf(quote)
  if (!saved) return null
  return { lock: true, status, legacyTotals: saved }
}

// ── What the reopened quote is held to ────────────────────────────────────
// Normally the card totals. On a sold order whose contract was reissued with
// Honor Signed Pricing (payload ct-honor), the builder holds the SIGNED
// contract's price instead (lock.source 'legacy+honor'), which can differ from
// the card (the card came from the screen, which never applied ct-honor).
// Returns {target, honored, card}: compare the screen with `target`.
export function lockTarget({ saved, lock }) {
  const honored = !!(saved && lock && lock.requested && lock.saved && lock.choice !== 'today'
    && /honor/.test(String(lock.source || '')))
  return honored
    ? { target: { total: r2(lock.saved.total), deposit: r2(lock.saved.deposit), balance: r2(lock.saved.balance) }, honored: true, card: saved }
    : { target: saved, honored: false, card: saved }
}

// ── Automatic documents (Generate Contract / Executed Copy / Revision from a card) ──
// kind: 'contract' | 'exec' | 'revision'. Returns {ok, wait, reason}.
// They run only while the saved price is held to the cent, the reopen had no
// issues, and (per the builder's canAutoDoc) no sold-order rule decision is open.
// "Saved price" = the card, or the signed contract's price on an honored sold order.
export function autoDocGate({ saved: card, screen, lock }) {
  if (!screen) return { ok: false, wait: true, reason: 'The builder has not priced the quote yet.' }
  if (!card) return { ok: true }
  const saved = lockTarget({ saved: card, lock }).target
  const diff = totalsDiffer(saved, screen)
  const drift = `saved ${fmtMoney(saved.total)}, the builder shows ${fmtMoney(screen.total)} (${fmtDelta(screen.total - saved.total)})`
  if (!lock || !lock.requested) {
    return diff ? { ok: false, reason: `The saved price is not held: ${drift}.` } : { ok: true }
  }
  if (!lock.ready) return { ok: false, wait: true, reason: 'Waiting for the saved price to load.' }
  if (lock.choice === 'today') return { ok: false, reason: `Today's pricing was applied: ${drift}.` }
  const issues = lock.issues || []
  if (!lock.ok || issues.length) {
    return { ok: false, reason: issues[0] || `The saved price could not be held exactly: ${drift}.` }
  }
  if (diff) return { ok: false, reason: `The price changed: ${drift}.` }
  const open = lock.compliance || []
  if (open.length) {
    return { ok: false, reason: `Sold order: ${open.length} rule decision${open.length === 1 ? '' : 's'} needed first (see the notice above the builder's Price Breakdown).` }
  }
  if (lock.canAutoDoc === false) return { ok: false, reason: 'The saved price is not confirmed yet (see the notice in the builder).' }
  return { ok: true }
}

// ── Confirm before a write ────────────────────────────────────────────────
// kind: 'save' | 'contract' | 'exec' | 'revision' | 'apply'.
// Returns {confirm, changed, title, okLabel, lines:[{label, from, to, delta}], notes:[]}.
// Every write to a quote that already has a saved price asks first and shows
// saved → new (owner plan: "one confirm dialog showing old → new on every
// write"), even when nothing changed — the dialog then says so. Only a brand-new
// quote (nothing saved yet) goes straight through.
const TITLES = {
  save: ['Save this quote at a new price?', 'Save quote'],
  contract: ['Generate a contract at a different price?', 'Generate contract'],
  exec: ['Executed copy at a different price?', 'Generate executed copy'],
  revision: ['Finish this revision?', 'Finish revision'],
  apply: ['Apply the revision changes?', 'Apply changes'],
}
export function writeCheck({ kind, saved, next, lock, status, reason = '' }) {
  const [title, okLabel] = TITLES[kind] || TITLES.save
  if (!saved) return { confirm: false, changed: false, title, okLabel, lines: [], notes: [] }
  const differ = totalsDiffer(saved, next)
  const notHolding = !!(lock && lock.requested && (lock.choice === 'today' || !lock.ok || (lock.issues || []).length))
  const { target, honored } = lockTarget({ saved, lock })
  const confirm = true
  // A revision of an honored sold order starts from the SIGNED contract (the same
  // original the Revision Order and the Revised Contract use), not the card.
  const from = kind === 'revision' && honored ? target : saved
  const lines = next ? [
    { label: kind === 'revision' ? 'Contract total' : 'Total', from: from.total, to: next.total, delta: r2(next.total - from.total) },
    { label: 'Deposit', from: from.deposit, to: next.deposit, delta: r2(next.deposit - from.deposit) },
    { label: 'Balance', from: from.balance, to: next.balance, delta: r2(next.balance - from.balance) },
  ] : []
  const notes = []
  if (reason) notes.push(reason)
  if (kind === 'revision' && honored && totalsDiffer(target, saved)) notes.push(`Original contract: the signed ${fmtMoney(target.total)} (Honor Signed Pricing; the card showed ${fmtMoney(saved.total)}).`)
  if (!differ && next && !notHolding && kind !== 'revision') notes.push(`No price change: the saved ${fmtMoney(saved.total)} is kept.`)
  if (honored && next && !totalsDiffer(target, next)) {
    notes.push(`Honor Signed Pricing: the builder holds the signed contract's ${fmtMoney(target.total)}${differ ? ` — the card showed ${fmtMoney(saved.total)}` : ''}.`)
  }
  if (lock && lock.choice === 'today') notes.push("Today's pricing was applied (\"Update to today's pricing\"), so the saved price is not kept.")
  else if (notHolding) notes.push('The saved price is not being held: ' + ((lock.issues || [])[0] || 'see the notice in the builder.'))
  else if (!lock && differ) notes.push("This builder repriced the quote with today's rules; the saved price is not held.")
  if (isSold(status) && differ && kind !== 'revision' && !(honored && !totalsDiffer(target, next))) notes.push('This is a sold order: the customer must re-sign for a new price.')
  if (kind === 'save') notes.push('The previous price and quote PDF stay in this quote’s history.')
  if (kind === 'contract') notes.push('A new contract PDF is added to Documents › Contracts. Earlier contracts are kept.')
  if (kind === 'exec') notes.push('The executed copy is added to Documents › Contracts. Earlier copies are kept.')
  if (kind === 'revision') notes.push('Saves the Revision Order and the Revised Contract, and updates this quote’s card to the revised price. The previous price stays in the quote’s history.')
  const signedPrice = honored && next && !totalsDiffer(target, next) && kind !== 'revision'
  return {
    confirm, changed: differ, okLabel, lines, notes,
    title: signedPrice ? `${okLabel} at the signed-contract price?` : (differ || kind === 'revision' ? title : okLabel + '?'),
  }
}

// ── Re-saving an existing quote ───────────────────────────────────────────
// Which of status / valid_through / notes a builder save may write.
//  - New quote: draft, valid 30 days, no notes (as before).
//  - Sold (verbal_accept / deposit_paid / revised): keep all three.
//  - Price changed: back to draft, valid 30 days from today.
//  - Price unchanged: keep the status; a draft / sent quote gets a fresh
//    30-day validity (a new quote PDF was generated).
// notes is never nulled on an existing quote.
export function planQuoteFields({ initialQuote, totals, now = new Date() }) {
  const valid = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  if (!initialQuote) return { status: 'draft', valid_through: valid, notes: null }
  if (isSold(initialQuote.status)) return {}
  if (totalsDiffer(savedTotalsOf(initialQuote), totals)) return { status: 'draft', valid_through: valid }
  if (initialQuote.status === 'draft' || initialQuote.status === 'sent' || !initialQuote.status) return { valid_through: valid }
  return {}
}

// The builder modal's copy of the saved row after a successful update, so a
// second save in the same session compares against (and records history
// from) what is now saved. quote_number / quote_date never change on update.
export function mergeSaved(cur, payload, now = new Date()) {
  if (!cur) return cur
  const { quote_number, quote_date, ...rest } = payload || {}
  const out = { ...cur }
  Object.keys(rest).forEach((k) => { if (rest[k] !== undefined) out[k] = rest[k] })
  out.updated_at = now.toISOString()
  return out
}

// Second guard for any builder update of an existing row (QuotesTab):
// sold statuses and notes are never overwritten by a save.
export function guardBuilderUpdate(original, fields) {
  const out = { ...fields }
  if (original && isSold(original.status)) delete out.status
  if (original && 'notes' in out && (out.notes == null || out.notes === '')) delete out.notes
  return out
}

// payload_json.price_history: the versions this quote replaced, newest last.
function historyPayload(p) {
  if (!p || typeof p !== 'object') return null
  const { rendering_thumb, price_history, ...rest } = p
  return rest
}
export function appendPriceHistory({ initialQuote, reason = 'update', next = null, now = new Date() }) {
  const prevPayload = initialQuote?.payload_json || null
  const prior = Array.isArray(prevPayload?.price_history) ? prevPayload.price_history.slice() : []
  const saved = savedTotalsOf(initialQuote)
  if (!initialQuote || (!saved && !initialQuote.pdf_snapshot_url)) return prior
  const entry = {
    at: initialQuote.updated_at || initialQuote.created_at || null,
    replaced_at: now.toISOString(),
    reason,
    status: initialQuote.status || null,
    total: saved ? saved.total : null,
    deposit: saved ? saved.deposit : null,
    balance: saved ? saved.balance : null,
    pdf: initialQuote.pdf_snapshot_url || null,
    priced_sub: prevPayload?.priced?.sub ?? null,
    new_total: next ? r2(next.total) : null,
    new_deposit: next ? r2(next.deposit) : null,
    new_balance: next ? r2(next.balance) : null,
    changed: !!(saved && next && totalsDiffer(saved, next)),
    payload: historyPayload(prevPayload),
  }
  const out = prior.concat([entry]).slice(-HISTORY_MAX)
  // Only the most recent few keep a full copy of the replaced build config.
  const cut = out.length - HISTORY_PAYLOAD_KEEP
  return out.map((e, i) => {
    if (i >= cut || !e || !('payload' in e)) return e
    const { payload, ...rest } = e
    return rest
  })
}

// ── Duplicate: priced fresh ───────────────────────────────────────────────
// Owner 9/30/26: "if i click duplicate or new quote then yes pricing should be
// up-to date". The copy keeps the build (so it opens ready to tweak) but none
// of the original's "as sold" state, so it prices exactly like a brand-new
// quote for the same building:
//  - no saved snapshot, totals or price history
//  - no rule overrides / grandfathering (overrides) and no rule decisions (hold-dec)
//  - no held price (hold-amt / hold-ref / hold-src)
//  - no Pricing-tab price edits (sessionEdits: table cells, door prices,
//    deposit %, free-upgrade threshold…)
//  - no Honor Signed Pricing (ct-honor / ct-honor-ref: the signed contract's price)
//  - 26GA that was the FREE auto-upgrade at sale (the $10k threshold, recorded
//    by the v3 snapshot) starts from standard sheeting, as a new quote does;
//    the builder re-applies the free upgrade if the copy qualifies today
// The copy's discount, tax, additional discount, manufacturer adjustment and
// manual (Input mode) prices are the rep's terms, not price-table state: kept.
// An older original (saved before payload.priced) keeps its card totals as
// freshBasis: the builder reads them once to recover what the old save did not
// store (roof style, free 26GA), then prices the copy fresh (restoreOptionsFor).
const AS_SOLD_FIELDS = [...HOLD_FIELDS, 'ct-honor', 'ct-honor-ref']
export function stripForDuplicate(payload, { fromQuote = null, newNumber = null, now = new Date() } = {}) {
  if (!payload || typeof payload !== 'object') return payload
  const { priced, overrides, price_history, totals, sessionEdits, freshBasis, ...rest } = payload
  const fields = { ...(rest.fields || {}) }
  AS_SOLD_FIELDS.forEach((k) => { delete fields[k] })
  if (priced && priced.free && priced.free.sheet && fields['sheeting-upgrade'] === 'upgrade') fields['sheeting-upgrade'] = 'standard'
  // (a copy of a copy that was never saved passes its own basis on)
  const basis = priced ? null : (savedTotalsOf(fromQuote) || freshBasisOf(freshBasis))
  return {
    ...rest,
    fields,
    ...(newNumber ? { quote_number: newNumber } : {}),
    priceFresh: true,
    ...(basis ? { freshBasis: basis } : {}),
    duplicatedFrom: fromQuote ? { id: fromQuote.id || null, quote_number: fromQuote.quote_number || null, at: now.toISOString() } : null,
  }
}

// ── Revision Order: make the change rows add up to the build's net change ──
// Rep-typed row amounts are often list prices; the order's totals come from
// the priced build (discount + tax + today's price of the change). Returns the
// amount of the extra row that reconciles them (0 when they already agree).
export const REVISION_ADJ_LABEL = 'Adjustment to final build price (after discount and tax)'
export function revisionReconcile(rows, net) {
  let sum = 0
  for (const r of rows || []) {
    const a = Number(r && r.amount)
    if (Number.isFinite(a)) sum += a
  }
  const adj = r2(r2(net) - r2(sum))
  return Math.abs(adj) < 0.005 ? 0 : adj
}

// The ORIGINAL contract figures for Finish Revision. The Revised Contract takes
// its "Original Deposit — Paid" and revision baseline from the builder's
// window._rvOrig, which the price lock sets to PriceLock.rvBaseline(): the
// saved totals of a sold order — on an order reissued with Honor Signed
// Pricing, the SIGNED contract's price, not the card's. The Revision Order uses
// the same figures so both documents state the same original contract.
// Returns {total, deposit, from} — from 'builder' (the lock's baseline) or
// 'modal' (no baseline: the RevisionModal's Original Contract / card, as before).
export function revisionOriginal({ pg, typed, card }) {
  let base = null
  try {
    const L = pg && pg.PriceLock
    if (L && typeof L.rvBaseline === 'function') base = L.rvBaseline()
  } catch { base = null }
  const t = num(base && base.total)
  if (t != null && t > 0) return { total: r2(t), deposit: r2(num(base.deposit) ?? 0), from: 'builder' }
  const c = card || {}
  return { total: num(typed) || num(c.total) || 0, deposit: num(c.deposit) || 0, from: 'modal' }
}
// RevisionModal hint: a sold order reissued with Honor Signed Pricing, saved
// before price snapshots existed — its card total is not the signed price, and
// only the builder (Apply to Building → Finish Revision) knows the signed one.
export function honoredLegacyOrder(quote) {
  const p = quote?.payload_json
  return !!(p && p.fields && !p.priced && isSold(quote.status) && (num(p.fields['ct-honor']) || 0) > 0)
}

// ── Top-bar banner (rep-facing) ───────────────────────────────────────────
// tone: 'ok' | 'warn' | 'error'. Returns null when there is nothing to show.
export function lockBanner({ saved: card, screen, lock }) {
  if (!card || !screen) return null
  // Honored sold order: the builder holds the signed contract's price, not the card's.
  const { target: saved, honored } = lockTarget({ saved: card, lock })
  const S = honored && totalsDiffer(card, saved)
    ? `${fmtMoney(saved.total)} (signed contract; the card shows ${fmtMoney(card.total)})`
    : fmtMoney(saved.total)
  const d = r2(screen.total - saved.total)
  const sold = lock && lock.sold
  const open = (lock && lock.compliance) || []
  const tail = open.length ? ` · Sold order: ${open.length} rule decision${open.length === 1 ? '' : 's'} needed before a new contract` : ''
  if (!lock || !lock.requested) {
    if (!totalsDiffer(saved, screen)) return { tone: 'ok', text: `Saved price ${S}` }
    return { tone: 'warn', text: `Saved ${S} · today's rules ${fmtMoney(screen.total)} (${fmtDelta(d)}) · nothing saved` }
  }
  if (!lock.ready) return { tone: 'warn', text: `Saved ${S} · loading the saved price…` }
  if (lock.choice === 'today') {
    return { tone: 'warn', text: `Today's pricing applied: saved ${S} → ${fmtMoney(screen.total)} (${fmtDelta(d)}) · nothing saved${sold ? ' · sold order: customer must re-sign' : ''}` }
  }
  const issues = lock.issues || []
  if (!lock.ok || issues.length) {
    return { tone: 'error', text: `Saved ${S} could not be held exactly — the builder shows ${fmtMoney(screen.total)} (${fmtDelta(d)}) · nothing saved`, detail: issues[0] || null }
  }
  if (totalsDiffer(saved, screen)) {
    return { tone: 'warn', text: `Saved ${S} → now ${fmtMoney(screen.total)} (${fmtDelta(d)}) · your changes are not saved yet${tail}` }
  }
  // Edits made since reopening are saved: today's-rules figure (computed for the
  // build as reopened) no longer applies to this build.
  if (lock.saved && totalsDiffer(lock.saved, screen)) {
    return { tone: open.length ? 'warn' : 'ok', text: `Saved ${S} · includes changes since reopening (${fmtDelta(screen.total - lock.saved.total)} on the original ${fmtMoney(lock.saved.total)})${tail}` }
  }
  const today = lock.today
  if (today && isFinite(Number(today.total)) && !sameCents(today.total, saved.total)) {
    return { tone: 'warn', text: `Saved price held: ${S} · today's rules would be ${fmtMoney(today.total)} (${fmtDelta(today.total - saved.total)}) · nothing saved${tail}` }
  }
  return { tone: open.length ? 'warn' : 'ok', text: `Saved price held: ${S}${tail}` }
}
