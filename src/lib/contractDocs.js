// contractDocs.js — contract numbering, the revised-contract hand-off and the
// "contract sent" / "executed" markers (owner 10/6/26). Pure functions only
// (unit-tested in node: tests/contractDocs.test.mjs) plus one small DB helper.
//
// NUMBERING (one scheme everywhere: "Rev <n>", n = the revision #):
//   first contract of a quote     = the quote's own number          SS-2026-00144
//   revised contract              = the ORIGINAL agreement's number + " Rev <n>"
//                                                                    SS-2026-00144 Rev 1, … Rev 2
//   a contract printed again      = the number it was first sent with (payload_json.contractSent.number)
// Contract PDFs already saved keep their file names; nothing here renames them.
// The program (quote-builder.html) prints window._ctNo; standalone it still
// generates a fresh SS-YYYY-NNNNN.

import { isSold } from './priceLockCrm.js'

const str = (v) => (v == null ? '' : String(v).trim())
export const REV_LABEL = 'Rev'
const REV_RE = /\s*(?:-|\s)Rev(?:-|\s)*([\w.]+)\s*$/i
const NUM_RE = /SS-\d{4}-\d{5}/

/** "Rev 2" */
export function revisionLabel(n) { return `${REV_LABEL} ${str(n) || '1'}` }
/** "SS-2026-00144 Rev 1" → "SS-2026-00144" */
export function stripRev(num) { return str(num).replace(REV_RE, '') }
/** "SS-2026-00144 Rev 2" → "2" (null when not a revision) */
export function revOf(num) { const m = REV_RE.exec(str(num)); return m ? m[1] : null }

/** The agreement a quote belongs to (the number its first contract carries). */
export function agreementRootOf(q) {
  const p = q?.payload_json || {}
  if (p.revisionOf) return stripRev(p.revisionOf.agreement_number || p.revisionOf.quote_number) || null
  if (p.contractSent && p.contractSent.number) return stripRev(p.contractSent.number)
  return str(q?.quote_number) || null
}
/** The number for this quote's contract (a first contract, or a reprint). */
export function contractNumberFor(q) {
  const p = q?.payload_json || {}
  if (p.contractSent && str(p.contractSent.number)) return str(p.contractSent.number)
  if (p.revisionOf && agreementRootOf(q)) return `${agreementRootOf(q)} ${revisionLabel(p.revisionOf.rev_no)}`
  return str(q?.quote_number) || null
}
/** A revised contract: the ORIGINAL agreement's number + " Rev <n>". */
export function revisedContractNumber(original, revNo) {
  const root = agreementRootOf(original)
  return root ? `${root} ${revisionLabel(revNo)}` : null
}
/** The next revision # for an original (its chain: a revision of a revision counts on). */
export function nextRevNo(original) {
  const p = original?.payload_json || {}
  // the revision this quote already is (Use as revision link, or a contract sent as "… Rev n")
  const prior = Math.max(Number(p.revisionOf?.rev_no) || 0, Number(revOf(p.contractSent?.number)) || 0)
  // a revision that was REDONE before the customer signed it does not count (its number is reused)
  const own = Array.isArray(p.revisions) ? p.revisions.filter((l) => !(l && l.redone)).length : 0
  return String(prior + own + 1)
}

// ── Redo a revision the customer has not signed yet (owner 10/19/26) ──────
// "what if i revise someones signed contract & either i mess up and need to redo after saving or i
// send for them to sign off on it and they want another tweak made before signing". A Use-as-revision
// quote is the active order from the moment it is made, but it is only SIGNED once its revised
// contract is stamped executed - and that stamp is not always made, so the rep is ASKED. Not signed:
// the new revision redoes it - same Rev number, compared with (and paid money from) the last version
// the customer did sign, and every unsigned revision of that version is retired. Signed: the new
// revision goes on top of it, as always.
const activeRevisionsOf = (baseId, quotes) =>
  (quotes || []).filter((q) => q && !q.deleted_at && q.status !== 'superseded' && q.payload_json?.revisionOf?.id === baseId)
const revNum = (q) => Number(q?.payload_json?.revisionOf?.rev_no)
/**
 * What a new revision of `picked` really revises. null = nothing to ask (revise `picked` as always);
 * { kind:'switch', to } = `picked` was replaced by a revision that IS stamped signed: revise that one;
 * { kind:'ask', revision, base, effective, redo, revNo } = `revision` is not stamped signed - ask the rep.
 *   base = the last version before the unsigned revision(s); effective = base with the status it had
 *   (it was set to "replaced" when the first revision was made); redo = the unsigned revisions a redo
 *   retires; revNo = the number the redo keeps.
 */
export function redoPlanFor(picked, quotes) {
  if (!picked || picked.deleted_at) return null
  let base = null
  let revision = null
  const rv = picked.payload_json?.revisionOf
  if (rv && picked.status !== 'superseded') {
    if (executedOf(picked)) return null
    base = (quotes || []).find((q) => q && q.id === rv.id && !q.deleted_at) || null
    if (!base) return null
    revision = picked
  } else if (picked.status === 'superseded') {
    const act = activeRevisionsOf(picked.id, quotes)
    if (!act.length) {
      // replaced only by revision(s) that were then DELETED (owner 10/19/26: "the revision i made but messed up
      // on & didnt send, ive also since deleted it"): the order is the signed one again - no question to ask
      const gone = deletedRevisionsOf(picked.id, quotes)
      if (!gone.length) return null
      return { kind: 'restore', revision: null, base: picked, effective: { ...picked, status: statusBefore(picked, gone) }, redo: [], dropped: gone.map((q) => q.id), revNo: lowestRevNo(gone, picked) }
    }
    const signedOne = act.find((q) => executedOf(q))
    if (signedOne) return { kind: 'switch', to: signedOne }
    base = picked
    revision = act.slice().sort((a, b) => (revNum(b) || 0) - (revNum(a) || 0) || String(b.payload_json.revisionOf.at || '').localeCompare(String(a.payload_json.revisionOf.at || '')))[0]
  } else {
    return null
  }
  const redo = activeRevisionsOf(base.id, quotes).filter((q) => !executedOf(q))
  if (!redo.some((q) => q.id === revision.id)) redo.push(revision)
  const gone = deletedRevisionsOf(base.id, quotes)
  return { kind: 'ask', revision, base, effective: { ...base, status: statusBefore(base, [...redo, ...gone]) }, redo, dropped: gone.map((q) => q.id), revNo: lowestRevNo([...redo, ...gone], base) }
}
const deletedRevisionsOf = (baseId, quotes) => (quotes || []).filter((q) => q && q.deleted_at && q.payload_json?.revisionOf?.id === baseId)
/** The status a replaced quote had before its revisions: signed (as they recorded) or not. */
function statusBefore(base, revisions) {
  if (isSold(base.status)) return base.status
  const wasSigned = revisions.some((q) => q.payload_json?.revisionOf?.signed === true)
  if (!wasSigned) return base.status === 'superseded' ? 'sent' : base.status
  return revisions.map((q) => q.status).find((s) => isSold(s)) || 'deposit_paid'
}
function lowestRevNo(revisions, base) {
  const nums = revisions.map(revNum).filter((n) => Number.isFinite(n) && n > 0)
  return nums.length ? String(Math.min(...nums)) : nextRevNo(base)
}

/**
 * An unsigned revision was DELETED (owner 10/19/26): the order it replaced is the order again - its signed
 * status back, "Replaced by" gone, the link flagged so its Rev number is reused, the star back.
 * Only when that revision was still the one replacing it. Returns a short note or null (nothing to do).
 */
export async function restoreAfterRevisionDeleted(sb, deletedId) {
  const { data: d0 } = await sb.from('quotes').select('id, status, starred, payload_json').eq('id', deletedId).single()
  const dq = Array.isArray(d0) ? d0[0] : d0
  const rv = dq?.payload_json?.revisionOf
  if (!rv || !rv.id || dq.status === 'superseded') return null
  const { data: o0 } = await sb.from('quotes').select('*').eq('id', rv.id).single()
  const o = Array.isArray(o0) ? o0[0] : o0
  if (!o || o.deleted_at || o.status !== 'superseded' || o.payload_json?.revisedBy?.id !== dq.id) return null
  const status = statusBefore({ ...o }, [dq])
  const p = { ...(o.payload_json || {}) }
  delete p.revisedBy
  p.revisions = revisionsAfterRedo(p.revisions, [dq.id])
  const { error } = await sb.from('quotes').update({ status, payload_json: p }).eq('id', o.id)
  if (error) throw error
  if (dq.starred === true && Object.prototype.hasOwnProperty.call(o, 'starred')) {
    try {
      await sb.from('quotes').update({ starred: false }).eq('id', dq.id)
      await sb.from('quotes').update({ starred: true }).eq('id', o.id)
    } catch { /* the star is best effort */ }
  }
  return `#${o.quote_number || ''} is the active order again`
}
/** The base quote's revision links after a redo: the redone ones flagged (their numbers are reused). */
export function revisionsAfterRedo(prev, redoIds) {
  const ids = new Set(redoIds || [])
  return (Array.isArray(prev) ? prev : []).map((l) => (l && ids.has(l.id) ? { ...l, redone: true } : l))
}
/** File-name form: "SS-2026-00144-Rev-1" */
export function contractFileBase(num) { return str(num).replace(/\s+/g, '-') }
/** The contract number printed in a contract's HTML (with its " Rev n"). */
export function contractNumberFromHtml(html) {
  const m = html && String(html).match(/SS-\d{4}-\d{5}(?: Rev [\w.]+)?/)
  return m ? m[0] : null
}
/** "SS-2026-00144-Rev-1-contract.pdf" → { number:"SS-2026-00144 Rev 1", base, rev } */
export function parseContractLabel(label) {
  const s = str(label)
  // uploads are sanitized ("SS-2026-00144 Rev 1 signed.pdf" → "SS-2026-00144_Rev_1_signed.pdf"): "_" separates too
  // the revision is a NUMBER ("Rev 1", "Revision 2"); "…_Revised_…" is not a revision number
  const m = /(SS-\d{4}-\d{5})(?:[-_\s]+Rev(?:ision)?[-_\s]*(\d+))?(?=[-_.\s]|$)/i.exec(s)
  if (!m) return null
  const base = m[1], rev = m[2] || null
  return { base, rev, number: rev ? `${base} ${revisionLabel(rev)}` : base }
}

// ── Which quote a contract file belongs to (Doc Hub › Stamp Executed) ──────
// { quote, candidates, how }: quote = the one match (null when none / several;
// candidates = the lead's live quotes to pick from).
export function matchContractQuote(label, quotes) {
  const live = (quotes || []).filter((q) => q && !q.deleted_at)
  const p = parseContractLabel(label)
  if (!p) return { quote: null, candidates: live, how: 'no number in the file name' }
  const by = (fn) => live.filter(fn)
  // several quotes with the number (a redo reuses its Rev number): the one that was not replaced
  const one = (h) => (h.length === 1 ? h[0] : (h.filter((q) => q.status !== 'superseded').length === 1 ? h.find((q) => q.status !== 'superseded') : null))
  let hit = by((q) => str(q.payload_json?.contractSent?.number) === p.number)
  if (one(hit)) return { quote: one(hit), candidates: live, how: 'contract number' }
  if (!hit.length) {
    hit = p.rev
      ? by((q) => q.payload_json?.revisionOf && stripRev(q.payload_json.revisionOf.agreement_number || q.payload_json.revisionOf.quote_number) === p.base && str(q.payload_json.revisionOf.rev_no) === p.rev)
      : by((q) => str(q.quote_number) === p.base)
    if (one(hit)) return { quote: one(hit), candidates: live, how: p.rev ? 'revision' : 'quote number' }
  }
  return { quote: null, candidates: live, how: hit.length > 1 ? 'several quotes match' : 'no quote has that number' }
}

// ── Status: deposit paid, never a step back ───────────────────────────────
const RANK = { draft: 0, sent: 1, expired: 1, declined: 1, verbal_accept: 2, deposit_paid: 3, revised: 4, superseded: 4 }
/** The status after "executed — deposit paid": deposit_paid, unless already further along. */
export function executedStatus(status) {
  const r = RANK[status]
  return r != null && r >= RANK.deposit_paid ? status : 'deposit_paid'
}

// ── Markers on payload_json (no migration) ────────────────────────────────
// contractSent: { at, number }  — a contract was generated (NOT a status)
// executed:     the customer SIGNED this quote's contract / revised contract (owner 10/19/26):
//   { at, signedOn, confirmed, file, filePath, stampedPath, markedAt }
//   signedOn = the day the customer signed (YYYY-MM-DD, typed by the rep); at = the same day (kept
//   truthy - executedOf reads it); confirmed = false while the day is only the day the stamp was made
//   (older stamps, the builder's Executed Copy) - the Doc Hub asks for the real day;
//   filePath = the signed copy in Documents › Contracts; stampedPath = its DEPOSIT PAID copy;
//   file = a file NAME (older stamps only stored this).
// They (and the revision links) ride along on every later builder save.
export const CRM_PAYLOAD_KEYS = ['contractSent', 'executed', 'revisionOf', 'revisedBy', 'revisions']
export function carryCrmMarkers(prevPayload, nextPayload) {
  const out = { ...(nextPayload || {}) }
  for (const k of CRM_PAYLOAD_KEYS) if (prevPayload && prevPayload[k] !== undefined && out[k] === undefined) out[k] = prevPayload[k]
  return out
}
export const contractSentOf = (q) => (q?.payload_json?.contractSent && q.payload_json.contractSent.at ? q.payload_json.contractSent : null)
export const executedOf = (q) => (q?.payload_json?.executed && q.payload_json.executed.at ? q.payload_json.executed : null)
/** "10/06/2026" */
export function fmtShortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso))
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const pad2 = (n) => String(n).padStart(2, '0')
/** A Date as the LOCAL calendar day "YYYY-MM-DD" (never toISOString: that is UTC, a day late after 8 PM). */
export function localDay(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  return Number.isNaN(x.getTime()) ? '' : `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`
}
/** A valid calendar day "YYYY-MM-DD" (rejects 2026-02-31), or null. */
export function cleanDay(v) {
  const s = str(v)
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const x = new Date(y, m - 1, d)
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? s : null
}
/** The day the customer signed this quote's contract ("YYYY-MM-DD"), or null (not marked signed). */
export function signedOnOf(q) {
  const ex = executedOf(q)
  if (!ex) return null
  const own = cleanDay(ex.signedOn) || cleanDay(ex.at)
  if (own) return own
  // an older stamp: a click time (ISO) -> that LOCAL day
  return localDay(new Date(str(ex.at))) || str(ex.at).slice(0, 10) || null
}
/** Was the signed day typed by the rep (true), or is it only the day a stamp was made (false)? */
export function signedDayConfirmed(q) { const ex = executedOf(q); return !!(ex && ex.confirmed === true) }
/** The contract number a signed mark is for: the mark's own (marks since 10/19/26), else the quote's. */
export function signedNumberOf(q) {
  const ex = executedOf(q)
  return ex ? (str(ex.number) || contractNumberFor(q)) : null
}
/** Signed? (status) and when — only a day the rep CONFIRMED (a stamp-click day is never printed as the
 *  day the customer signed: that was Peter Mawn's "signed October 13"). */
export function signedInfoOf(q) {
  return { signed: isSold(q?.status), date: signedDayConfirmed(q) ? signedOnOf(q) : null }
}
/** q's revision chain [q, its base, …, root]; complete = it reached a quote that is not a revision
 *  (a base missing from `quotes`, or a loop in bad data, leaves it incomplete). */
export function revisionChain(q, quotes) {
  const chain = [q]
  const seen = new Set([q && q.id])
  let cur = q
  for (let i = 0; i < 20 && cur?.payload_json?.revisionOf?.id; i++) {
    const up = (quotes || []).find((x) => x && x.id === cur.payload_json.revisionOf.id)
    if (!up || seen.has(up.id)) return { chain, complete: false }
    seen.add(up.id)
    chain.push(up)
    cur = up
  }
  return { chain, complete: !cur?.payload_json?.revisionOf?.id }
}
/** The original quote at the root of q's revision chain (q itself when it is not a revision). */
export function agreementRootQuote(q, quotes) { const { chain } = revisionChain(q, quotes); return chain[chain.length - 1] }
// a contract the customer SIGNED (a verbal accept is not one)
const SIGNED_STATUS = ['deposit_paid', 'revised']
/** Was q a SIGNED contract (marked, or Deposit Paid / Revised)? Recorded on a revision's link
 *  (revisionOf.signed_contract) — revisionOf.signed also counts a verbal accept (isSold). */
export function signedContractOf(q) { return !!executedOf(q) || SIGNED_STATUS.includes(q?.status) }
// did the base of `link` sign? (links before 10/19/26 only have `signed`, which counts a verbal accept too)
const linkBaseSigned = (rv) => (rv && rv.signed_contract !== undefined ? rv.signed_contract === true : rv?.signed === true)
/**
 * The day the AGREEMENT was signed ("REVISION 2 to Agreement SS-…, signed September 24, 2026").
 * The agreement = the first contract the customer signed in the chain: the root, unless the root was
 * never signed and its revision was made "not signed" (revisionOf.signed === false) — then that revision.
 * day: that quote's mark, only when the rep CONFIRMED the day (never a stamp-click day), and on the root
 * only a mark for the ORIGINAL contract (not an in-place "Rev n" on the same row). Never a later revision's.
 * { day, node, number, needsDay }: needsDay = not known, the agreement WAS signed and the chain is whole —
 * ask before a revised contract is printed (the answer goes on `node`, for contract `number`).
 */
export function agreementSignedDay(q, quotes) {
  const { chain, complete } = revisionChain(q, quotes)
  const down = chain.slice().reverse() // root → q
  const wasSigned = (k) => {
    const n = down[k]
    return signedContractOf(n) || (n?.status === 'superseded' && linkBaseSigned(down[k + 1]?.payload_json?.revisionOf))
  }
  // step down past a base the customer never signed (unsigned, or only verbally accepted)
  let i = 0
  while (i < down.length - 1 && !wasSigned(i) && down[i + 1]?.payload_json?.revisionOf && !linkBaseSigned(down[i + 1].payload_json.revisionOf)) i++
  const node = down[i] || q
  const isRoot = i === 0
  const ex = executedOf(node)
  const forIt = !ex || !isRoot || !revOf(signedNumberOf(node))
  const day = ex && forIt && signedDayConfirmed(node) ? signedOnOf(node) : null
  const number = isRoot ? agreementRootOf(node) : contractNumberFor(node)
  return { day, node, root: node, number, needsDay: !day && forIt && wasSigned(i) && complete }
}
export function agreementSignedOn(q, quotes) { return agreementSignedDay(q, quotes).day }
/** The same walk against the database (the builder has no list of the lead's quotes). q itself is read
 *  again too: a day typed a moment ago ("When did he sign?") must count (review 10/19/26). */
export async function agreementSignedDayDb(sb, q) {
  const read = async (id) => {
    try {
      const { data } = await sb.from('quotes').select('id, status, quote_number, payload_json').eq('id', id).single()
      return (Array.isArray(data) ? data[0] : data) || null
    } catch { return null }
  }
  const fresh = q?.id ? await read(q.id) : null
  // the caller's status stays (a redo passes the status the base had before its unsigned revisions)
  const me = fresh && fresh.payload_json ? { ...q, payload_json: fresh.payload_json } : q
  const list = [me]
  let cur = me
  for (let i = 0; i < 20 && cur?.payload_json?.revisionOf?.id; i++) {
    const id = cur.payload_json.revisionOf.id
    if (list.some((x) => x && x.id === id)) break
    const up = await read(id)
    if (!up) break
    list.push(up)
    cur = up
  }
  return agreementSignedDay(me, list)
}
export async function agreementSignedOnDb(sb, q) { return (await agreementSignedDayDb(sb, q)).day }

// Merge a marker into a quote's payload_json in the database (re-reads the row
// first so nothing saved since is lost). Returns the merged payload, or null.
export async function markQuote(sb, id, patch) {
  if (!id) return null
  let cur = null
  try {
    const { data } = await sb.from('quotes').select('payload_json').eq('id', id).single()
    const row = Array.isArray(data) ? data[0] : data
    cur = row?.payload_json || null
  } catch { /* fall through */ }
  if (!cur || typeof cur !== 'object') return null
  const next = { ...cur, ...patch }
  const { error } = await sb.from('quotes').update({ payload_json: next }).eq('id', id)
  if (error) throw error
  return next
}

// ── The revised contract hand-off (window._rvDoc for the program) ─────────
// lines: Use-as-revision lines (auto: diffBuilds/priceChanges; manual: typed) or
// the Revision Order rows ({desc, kind:'Add'|'Remove'|'Modify', amount}).
// signedDate = the day the AGREEMENT was signed (agreementSignedOn / agreementSignedOnDb - owner 10/19/26:
// Peter Mawn's printed the day an Executed Copy was clicked); without it, the revised quote's own signed day.
// Passed (even null = not known) it wins: a revision's own signed day is never printed as the agreement's.
export function revisionDocFor({ original, lines, revNo, originalTotal, depositPaid, adjustment = 0, adjLabel = '', agreementNo = null, agreementSignedDate = undefined }) {
  const sig = signedInfoOf(original)
  if (agreementSignedDate !== undefined) sig.date = cleanDay(agreementSignedDate)
  const out = (lines || []).filter((l) => l && l.include !== false).map((l) => {
    const isRow = !l.kind || /^(Add|Remove|Modify)$/.test(l.kind)
    const kind = isRow ? 'manual' : l.kind
    const printKind = l.printKind || (isRow ? l.kind || 'Modify' : 'Modify')
    const amount = l.printAmount != null ? Number(l.printAmount) : (l.amount == null || l.amount === '' ? null : Number(l.amount))
    const o = { kind, printKind, desc: str(l.printDesc || l.desc), amount: Number.isFinite(amount) ? amount : null }
    if (l.kind === 'move') { o.wall = l.wall || ''; o.from = l.from || []; o.to = l.to || []; if ('fromSill' in l || 'toSill' in l) { o.fromSill = l.fromSill ?? ''; o.toSill = l.toSill ?? '' } }
    return o
  })
  return {
    agreementNo: agreementNo || agreementRootOf(original),
    revNo: str(revNo) || '1',
    signed: sig.signed,
    signedDate: sig.date,
    originalTotal: Number(originalTotal) || 0,
    depositPaid: sig.signed ? (Number(depositPaid) || 0) : 0,
    adjustment: Number(adjustment) || 0,
    adjLabel,
    lines: out,
  }
}

// Which components of the revised build are new / changed, with the change's
// price for a CHANGED one: { doors: { 2: { kind:'change', delta: 345 } }, … }
export function newDetailOf(lines) {
  const out = {}
  for (const l of lines || []) {
    if (l.include === false || !(l.kind === 'add' || l.kind === 'change') || !Number.isInteger(l.nextIndex)) continue
    const d = (out[l.cat] = out[l.cat] || {})
    d[l.nextIndex] = { kind: l.kind, delta: l.kind === 'change' && Number.isFinite(Number(l.amount)) && l.amount !== null ? Number(l.amount) : null }
  }
  return out
}

// Use-as-revision picker order: signed / ordered first, then contract sent, then
// the rest (an already-replaced quote last), newest first within each.
export function pickerRank(c) {
  if (c.replaced) return 3
  if (c.sold) return 0
  if (contractSentOf(c.q)) return 1
  return 2
}

// ── Money already paid (owner rule 10/6/26) ───────────────────────────────
// ONE balance rule for a revised order — contract (the program's rvBalance is the
// same formula), Revision Order, Use-as-revision modal, quote card: money already
// paid is credited. additional = what is still owed on the revised deposit;
// balance = revised total − paid − additional, never negative (an overpayment
// is a refund due to the buyer).
const c2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export function revisedBalance(total, deposit, paid) {
  const t = c2(total), d = c2(deposit), p = c2(paid)
  const additional = Math.max(0, c2(d - p))
  const rest = c2(t - p - additional)
  return { paid: p, additional, balance: Math.max(0, rest), refund: Math.max(0, c2(-rest)) }
}
const numOr = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))
// What the buyer has actually paid on the order this quote is (before a new
// revision): an unsigned quote nothing; a signed original its deposit; a revised
// order everything paid across the chain — the paid deposit before that
// revision + the additional deposit it asked for (= max of the two), never the
// revised quote's card deposit alone.
export function paidOf(q, signedDeposit = null) {
  if (!q || !isSold(q.status)) return 0
  const rv = q.payload_json?.revisionOf
  if (rv) {
    const total = numOr(rv.paid_total, null)
    if (total != null) return c2(total)
    const before = numOr(rv.paid_before, numOr(rv.signed_deposit, 0))
    return c2(Math.max(before, numOr(q.deposit_amount, 0)))
  }
  return c2(numOr(signedDeposit, numOr(q.deposit_amount, 0)))
}
/** The quote card's balance on a revised order (null = show the stored balance as before). */
export function cardBalanceOf(q) {
  const rv = q?.payload_json?.revisionOf
  if (!rv || q.status === 'superseded' || q.total_amount == null || q.deposit_amount == null) return null
  const before = numOr(rv.paid_before, numOr(rv.signed_deposit, null))
  if (before == null) return null
  return revisedBalance(q.total_amount, q.deposit_amount, before)
}

// ── "Executed — Deposit Paid" (Doc Hub stamp AND the builder's Executed Copy) ──
// The signed order's quote → deposit_paid unless already further along, the
// executed date on payload_json.executed, and the star (Open Layout's quote;
// skipped silently without the starred column). The row is re-read first so
// nothing saved since is lost. A status the rep sets by hand afterwards wins.
// Returns { status, changed, starred, at, confirmed } (throws on a failed write).
//
// The signed DAY (owner 10/19/26): signedOn = the day the customer signed, typed by the rep (Doc Hub ›
// Mark as signed). Without it an existing signed day is KEPT (an Executed Copy clicked again never moves
// it); a first stamp without one takes today, flagged not confirmed (the Doc Hub asks for the real day).
// keepStamped: the builder's Executed Copy never replaces a DEPOSIT PAID copy already linked (that one is
// the customer's signed pages). stampAt: an older stamp's click time, kept once the day is typed (it tells
// which same-named file was the stamped one).
const stampAtOf = (p) => (p ? (p.stampAt || (DAY_RE.test(str(p.at)) ? null : str(p.at) || null)) : null)
export function nextExecuted(prev, { signedOn = null, at = null, file, filePath, stampedPath, number, keepStamped = false } = {}, now = new Date()) {
  const p = prev && prev.at ? prev : null
  // keep only the stamp of the CUSTOMER's signed pages (a signed copy is linked, or it is the Doc Hub's
  // "-EXECUTED-deposit-paid.pdf"); the builder's own earlier copy is replaced by its newer one
  if (keepStamped && p && p.stampedPath && (p.filePath || /-EXECUTED-deposit-paid\.pdf$/.test(str(p.stampedPath)))) stampedPath = undefined
  let day = cleanDay(signedOn) || cleanDay(at)
  let confirmed = !!day
  // a click time passed in (ISO) = that LOCAL day, not confirmed as the signing day
  if (!day && at && localDay(new Date(str(at)))) day = localDay(new Date(str(at)))
  if (!day && p) { day = signedOnOf({ payload_json: { executed: p } }); confirmed = p.confirmed === true }
  if (!day) { day = localDay(now); confirmed = false }
  const out = { ...(p || {}), at: day, signedOn: day, confirmed, markedAt: now.toISOString() }
  if (stampAtOf(p)) out.stampAt = stampAtOf(p)
  if (file !== undefined) out.file = file
  if (filePath !== undefined) out.filePath = filePath
  if (stampedPath !== undefined) out.stampedPath = stampedPath
  if (number) out.number = number // the contract number this signature is for ("SS-… Rev 1")
  return out
}
export async function markExecuted(sb, quoteId, opts = {}) {
  const { data, error: e0 } = await sb.from('quotes').select('*').eq('id', quoteId).single()
  if (e0) throw e0
  const q = Array.isArray(data) ? data[0] : data
  if (!q) throw new Error('the quote was not found')
  const next = executedStatus(q.status)
  const executed = nextExecuted(q.payload_json?.executed, opts)
  const upd = { payload_json: { ...(q.payload_json || {}), executed } }
  if (next !== q.status) upd.status = next
  const { error } = await sb.from('quotes').update(upd).eq('id', q.id)
  if (error) throw error
  let starred = q.starred === true
  const canStar = Object.prototype.hasOwnProperty.call(q, 'starred')
  if (!starred && q.status !== 'superseded' && canStar) {
    try {
      const { error: e1 } = await sb.from('quotes').update({ starred: false }).eq('client_id', q.client_id).eq('starred', true).neq('id', q.id)
      if (!e1) { const { error: e2 } = await sb.from('quotes').update({ starred: true }).eq('id', q.id); starred = !e2 }
    } catch { /* the star is best effort */ }
  }
  return { status: next, changed: next !== q.status, starred, at: executed.at, confirmed: executed.confirmed, quote_number: q.quote_number, payload_json: upd.payload_json }
}
/** The toast for markExecuted's result. */
export function executedToast(res, label) {
  const day = res.confirmed ? `signed ${fmtShortDate(res.at)}` : 'signed date not set yet (set it in Documents › Contracts)'
  const st = res.changed ? 'marked Deposit Paid' : res.status === 'deposit_paid' ? 'already Deposit Paid' : `kept as ${label} (already further along)`
  return `Quote #${res.quote_number || ''} ${st} · ${day}${res.starred ? ' · ★ starred' : ''}`
}

// Change the signed mark itself (re-reads the row; nothing else on it changes).
async function patchExecuted(sb, quoteId, fn) {
  const { data, error: e0 } = await sb.from('quotes').select('id, payload_json').eq('id', quoteId).single()
  if (e0) throw e0
  const q = Array.isArray(data) ? data[0] : data
  if (!q || !q.payload_json || typeof q.payload_json !== 'object') throw new Error('the quote was not found')
  const p = { ...q.payload_json }
  const ex = fn(p.executed && p.executed.at ? p.executed : null)
  if (ex) p.executed = ex
  else delete p.executed
  const { error } = await sb.from('quotes').update({ payload_json: p }).eq('id', q.id)
  if (error) throw error
  return p
}
/** The rep types the day the customer really signed. */
// create: an order sold before signed marks existed gets a mark with just that day (no status / star change).
// number: the contract this day is for (kept on a mark that has none — e.g. the agreement's day asked
// before a revised contract, on a root whose contract number later became "Rev n").
export async function setSignedDay(sb, quoteId, day, { create = false, number = null } = {}) {
  const d = cleanDay(day)
  if (!d) throw new Error('pick the date the customer signed')
  return patchExecuted(sb, quoteId, (ex) => {
    if (!ex && !create) throw new Error('this quote is not marked signed')
    const out = { ...(ex || {}), at: d, signedOn: d, confirmed: true, markedAt: new Date().toISOString() }
    if (stampAtOf(ex)) out.stampAt = stampAtOf(ex)
    if (number && !str(out.number)) out.number = number
    return out
  })
}
/** Take the signed mark off (marked by mistake). The status is left as it is - the rep sets it. */
export async function clearSignedMark(sb, quoteId) {
  return patchExecuted(sb, quoteId, () => null)
}
/**
 * A builder save carries the payload it opened with; the signed mark may have been set, changed or
 * removed in the Doc Hub since. The DATABASE wins for `executed` (it is never set through the builder's
 * payload). Returns the payload to write.
 */
export async function withLiveExecuted(sb, quoteId, payload) {
  if (!quoteId || !payload || typeof payload !== 'object') return payload
  let live
  try {
    const { data, error } = await sb.from('quotes').select('payload_json').eq('id', quoteId).single()
    if (error) return payload
    live = (Array.isArray(data) ? data[0] : data)?.payload_json
  } catch { return payload }
  if (!live || typeof live !== 'object') return payload
  const out = { ...payload }
  if (live.executed && live.executed.at) out.executed = live.executed
  else delete out.executed
  return out
}

/** The revision label a quote's papers carry — the same "Rev <n>" as its contract
 *  number ("SS-2026-00144 Rev 1"); '' for a quote that is not a revision. */
export function revLabelOf(q) {
  const p = q?.payload_json || {}
  const n = (p.revisionOf && str(p.revisionOf.rev_no)) || revOf(p.contractSent && p.contractSent.number)
  return n ? revisionLabel(n) : ''
}

// ── Documents › Contracts, sorted (owner 10/19/26: "he doesnt have 19 contracts ... its a rats nest
// and there is no way to mark the contract thats signed") ─────────────────────────────────────────
// Every Generate Contract / Executed Copy / revision adds a file, and nothing said which one the
// customer signed. Nothing is renamed, moved or deleted: the list is SORTED from the files' names and
// the quotes' signed marks (payload_json.executed):
//   signed   - one entry per quote marked signed (its signed copy, its DEPOSIT PAID copy, the
//              contracts we generated for that number), grouped by agreement, original first;
//   unsigned - contracts we generated that nobody marked signed, one group per contract number
//              (newest first; older copies of the same number folded);
//   uploads  - files with no contract number that are not linked to a signed quote.
const STAMP_RE = /-executed-deposit-paid\.pdf$/i
/** A DEPOSIT PAID copy (the builder's Executed Copy, or the Doc Hub stamp of a signed file). */
export const isStampedCopy = (label) => STAMP_RE.test(str(label))
const tsOf = (f) => { const t = Date.parse(f?.createdAt || ''); return Number.isFinite(t) ? t : 0 }
const newestFirst = (files) => (files || []).slice().sort((a, b) => tsOf(b) - tsOf(a))
const revNoOf = (q) => Number(q?.payload_json?.revisionOf?.rev_no) || Number(revOf(q?.payload_json?.contractSent?.number)) || 0
const low = (s) => str(s).toLowerCase()
const noExt = (s) => str(s).replace(/\.[^.]+$/, '')

/** Same-named files (the same document saved again): { latest, older[] }, newest first. */
export function groupByLabel(files) {
  const map = new Map()
  for (const f of newestFirst(files)) {
    const k = low(f.label)
    if (!map.has(k)) map.set(k, { latest: f, older: [] })
    else map.get(k).older.push(f)
  }
  return [...map.values()]
}

/** "Original contract" / "Revision 2" — what a quote's contract is, in the owner's words. */
export function contractRoleOf(q) {
  const n = revNoOf(q)
  return n ? `Revision ${n}` : 'Original contract'
}

export function organizeContracts(files, quotes) {
  const live = (quotes || []).filter((q) => q && !q.deleted_at)
  const all = newestFirst(files)
  const used = new Set()
  const take = (f) => { used.add(f.path); return f }
  const free = (pred) => all.find((f) => !used.has(f.path) && pred(f)) || null

  // a mark knows its contract number (marks since 10/19/26); older ones take the quote's
  const markRev = (q) => { const ex = executedOf(q); return ex && str(ex.number) ? Number(revOf(ex.number)) || 0 : revNoOf(q) }
  const signed = live.filter((q) => executedOf(q)).map((q) => ({
    quote: q,
    number: signedNumberOf(q),
    agreement: agreementRootOf(q),
    rev: markRev(q),
    role: markRev(q) ? `Revision ${markRev(q)}` : 'Original contract',
    signedOn: signedOnOf(q),
    confirmed: signedDayConfirmed(q),
    current: q.status !== 'superseded',
    signedFile: null,
    stampedFile: null,
    generated: [],
  }))
  // 1) the files a signed mark points at (new marks: storage paths)
  for (const s of signed) {
    const ex = executedOf(s.quote)
    if (ex.filePath) { const f = free((x) => x.path === ex.filePath); if (f) s.signedFile = take(f) }
    if (ex.stampedPath) { const f = free((x) => x.path === ex.stampedPath); if (f) s.stampedFile = take(f) }
  }
  // 2) older marks stored only a file NAME: the newest file of that name that existed when the mark
  //    was made (a copy generated again later is not the one that was signed), else the newest
  for (const s of signed) {
    const ex = executedOf(s.quote)
    const name = str(ex.file)
    if (!name) continue
    const clickTs = Date.parse(str(stampAtOf(ex))) || Date.parse(str(ex.markedAt)) || 0
    const f = (clickTs && free((x) => low(x.label) === low(name) && tsOf(x) && tsOf(x) <= clickTs + 120000)) || free((x) => low(x.label) === low(name))
    if (!f) continue
    if (isStampedCopy(name)) { if (!s.stampedFile) s.stampedFile = take(f) } else if (!s.signedFile) s.signedFile = take(f)
  }
  // 3) the Doc Hub stamp's pair: "<signed file>-EXECUTED-deposit-paid.pdf" beside "<signed file>.pdf"
  for (const s of signed) {
    if (s.signedFile && !s.stampedFile) {
      const want = low(noExt(s.signedFile.label) + '-executed-deposit-paid.pdf')
      const f = free((x) => low(x.label) === want)
      if (f) s.stampedFile = take(f)
    }
    if (s.stampedFile && !s.signedFile && /-EXECUTED-deposit-paid\.pdf$/.test(s.stampedFile.label)) {
      const want = low(s.stampedFile.label.replace(/-EXECUTED-deposit-paid\.pdf$/, ''))
      const f = free((x) => low(noExt(x.label)) === want && !isStampedCopy(x.label))
      if (f) s.signedFile = take(f)
    }
  }
  // 4) everything else by the contract number in its name
  const signedByNumber = new Map()
  for (const s of signed) if (s.number && !signedByNumber.has(low(s.number))) signedByNumber.set(low(s.number), s)
  const groups = new Map()
  const uploads = []
  for (const f of all) {
    if (used.has(f.path)) continue
    const p = parseContractLabel(f.label)
    if (!p) { uploads.push(f); continue }
    const s = signedByNumber.get(low(p.number))
    if (s) {
      // a copy of a contract that is signed now: a DEPOSIT PAID copy, else one we generated
      if (isStampedCopy(f.label) && !s.stampedFile) s.stampedFile = take(f)
      else s.generated.push(take(f))
      continue
    }
    if (!groups.has(low(p.number))) groups.set(low(p.number), { number: p.number, files: [] })
    groups.get(low(p.number)).files.push(f)
  }
  const unsigned = [...groups.values()].map((g) => {
    const m = matchContractQuote(g.files[0].label, live)
    return {
      number: g.number,
      latest: g.files[0],
      older: g.files.slice(1),
      quote: m.quote,
      stamped: g.files.some((f) => isStampedCopy(f.label)),
      old: !m.quote || m.quote.status === 'superseded',
    }
  }).sort((a, b) => (a.old - b.old) || tsOf(b.latest) - tsOf(a.latest))

  // signed, grouped by agreement: original first, then each revision; newest agreement first
  const byAgr = new Map()
  for (const s of signed) {
    const k = low(s.agreement || s.number || s.quote.id)
    if (!byAgr.has(k)) byAgr.set(k, { key: k, agreement: s.agreement || s.number || null, entries: [] })
    byAgr.get(k).entries.push(s)
  }
  const agreements = [...byAgr.values()].map((a) => {
    a.entries.sort((x, y) => x.rev - y.rev || String(x.signedOn || '').localeCompare(String(y.signedOn || '')))
    // the version the order stands on now: the newest signed one that was not replaced
    const cur = a.entries.filter((e) => e.current)
    a.latest = (cur.length ? cur : a.entries)[(cur.length ? cur : a.entries).length - 1]
    return a
  }).sort((x, y) => String(y.entries[0]?.signedOn || '').localeCompare(String(x.entries[0]?.signedOn || '')))

  return { agreements, signed, unsigned, uploads: newestFirst(uploads) }
}

/** The lead's quotes for "Which order did the customer sign?" — the file's own match first, then
 *  orders (sold), then the rest; replaced quotes last. */
export function signedPickList(quotes, label = '') {
  const live = (quotes || []).filter((q) => q && !q.deleted_at)
  const m = label ? matchContractQuote(label, live) : { quote: null }
  const rank = (q) => (m.quote && q.id === m.quote.id ? 0 : q.status === 'superseded' ? 4 : executedOf(q) ? 2 : isSold(q.status) ? 1 : 3)
  return { match: m.quote || null, list: live.slice().sort((a, b) => rank(a) - rank(b) || String(b.quote_date || b.created_at || '').localeCompare(String(a.quote_date || a.created_at || ''))) }
}
