// contractClause: the contract's optional CONDITIONAL CLAUSE (owner 11/2/26: "once we click generate contract there should be
// an option to 'add conditional clause' & then why its conditional - again in his case its conditional upon permitting").
//
// The quote program owns the clause: Section 14 fields ct-cond ('' | 'permit' | 'other') and ct-cond-why (what an 'other'
// clause is conditional upon), saved with the quote like the other contract fields; printContract adds Addendum A and
// points to it from page 1 and the Terms' acknowledgment. The CRM asks at Generate Contract (ContractClauseAsk), writes the
// answer into the program, and keeps it on the saved quote so a later Executed Copy / revision prints the same Addendum.
//
// Plain JS, no imports (node-testable).

export const CLAUSE_KINDS = ['', 'permit', 'other']
export const WHY_MAX = 160

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, WHY_MAX)

/** A clause as the program keeps it: { kind, why } (kind '' = none; why only for 'other'). */
export function normClause(c) {
  const kind = c && CLAUSE_KINDS.includes(c.kind) ? c.kind : ''
  return { kind, why: kind === 'other' ? clean(c.why) : '' }
}

/** The clause in saved quote fields (a quote saved before the option existed has none). */
export function clauseOfFields(fields) {
  const f = fields && typeof fields === 'object' ? fields : {}
  return normClause({ kind: f['ct-cond'] || '', why: f['ct-cond-why'] || '' })
}

/** The two program fields for a clause. */
export function clauseFields(c) {
  const n = normClause(c)
  return { 'ct-cond': n.kind, 'ct-cond-why': n.why }
}

export const sameClause = (a, b) => {
  const x = normClause(a)
  const y = normClause(b)
  return x.kind === y.kind && x.why === y.why
}

/** 'other' needs its "conditional upon" words; anything else is complete. */
export const clauseReady = (c) => normClause(c).kind !== 'other' || normClause(c).why.length > 0

/** A saved quote's payload with the clause written into its fields (the SAME object when nothing changes). */
export function payloadWithClause(payload, c) {
  if (!payload || typeof payload !== 'object') return payload
  const f = payload.fields && typeof payload.fields === 'object' ? payload.fields : {}
  const want = clauseFields(c)
  if (sameClause(clauseOfFields(f), c) && 'ct-cond' in f) return payload
  return { ...payload, fields: { ...f, ...want } }
}

/** Short words for a toast / the dialog. */
export function clauseLabel(c, county = '') {
  const n = normClause(c)
  if (n.kind === 'permit') return `conditional upon permit approval${county ? ` (${county.replace(/\s+County$/i, '')} County)` : ''}`
  if (n.kind === 'other') return `conditional upon ${n.why}`
  return 'no conditional clause'
}

// ── In the program window ────────────────────────────────────────────────────
/** The program's clause, or null when this program has no clause option (an older program). */
export function clauseFromProgram(pg) {
  const d = pg && pg.document
  const k = d && d.getElementById('ct-cond')
  if (!k) return null
  const w = d.getElementById('ct-cond-why')
  return normClause({ kind: k.value, why: w ? w.value : '' })
}

/** Put a clause into the program (its own ctCondUi shows / hides the rows). */
export function applyClauseToProgram(pg, c) {
  const d = pg && pg.document
  const k = d && d.getElementById('ct-cond')
  if (!k) return false
  const f = clauseFields(c)
  k.value = f['ct-cond']
  const w = d.getElementById('ct-cond-why')
  if (w) w.value = f['ct-cond-why']
  try { if (typeof pg.ctCondUi === 'function') pg.ctCondUi() } catch { /* ignore */ }
  return true
}
