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
  const own = Array.isArray(p.revisions) ? p.revisions.length : 0
  return String(prior + own + 1)
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
  const m = /(SS-\d{4}-\d{5})(?:[-\s]+Rev[-\s]*([\w]+?))?(?=[-_.\s]|$)/i.exec(s)
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
  let hit = by((q) => str(q.payload_json?.contractSent?.number) === p.number)
  if (hit.length === 1) return { quote: hit[0], candidates: live, how: 'contract number' }
  if (!hit.length) {
    hit = p.rev
      ? by((q) => q.payload_json?.revisionOf && stripRev(q.payload_json.revisionOf.agreement_number || q.payload_json.revisionOf.quote_number) === p.base && str(q.payload_json.revisionOf.rev_no) === p.rev)
      : by((q) => str(q.quote_number) === p.base)
    if (hit.length === 1) return { quote: hit[0], candidates: live, how: p.rev ? 'revision' : 'quote number' }
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
// executed:     { at, file }    — a signed contract was stamped "executed — deposit paid"
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
/** Signed? (status) and when (the executed stamp, when known). */
export function signedInfoOf(q) {
  const ex = executedOf(q)
  return { signed: isSold(q?.status), date: ex ? str(ex.at).slice(0, 10) : null }
}

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
export function revisionDocFor({ original, lines, revNo, originalTotal, depositPaid, adjustment = 0, adjLabel = '', agreementNo = null }) {
  const sig = signedInfoOf(original)
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
