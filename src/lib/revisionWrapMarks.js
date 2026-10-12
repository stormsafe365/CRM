// revisionWrapMarks.js — wrap-around lean-to marks "as signed" for the Revised Contract (verify 10/12/26).
// Pure: works on an injected program window (pg), so it is unit-tested in node (tests/leanToWrap.test.mjs).

// ── Wrap-around lean-to marks "as signed" (the Revised Contract's CHANGED / ADDED tags) ──
// The program tags a lean-to row CHANGED when its wrapped length differs from the order's
// (el.dataset.rvWrap) and a corner fee ADDED when the corner isn't in the order (window._rvWraps).
// These are read from the SIGNED build as the engine reopened it: { active: 'FL,FR', lts: [{sig, len}] }.
// sig = what identifies the lean-to across the two builds (side, size, start, type). null = an older program.
const ltSigOf = (el) => ['.lts', '.ltw', '.ltl2', '.ltoff', '.lt-type'].map((c) => { const f = el.querySelector(c); return f ? String(f.value) : '' }).join('|')
export function wrapMarksOf(pg) {
  try {
    if (typeof pg.ltWraps !== 'function' || typeof pg.ltWrapOf !== 'function') return null
    const wr = pg.ltWraps()
    return { active: wr.active.join(','), lts: [...pg.document.querySelectorAll('.lte.entry')].map((el) => ({ sig: ltSigOf(el), len: pg.ltWrapOf(el, wr).len || 0 })) }
  } catch { return null }
}
// Put the signed build's wrap marks on the live (revised) builder: an unchanged lean-to gets the wrapped
// length it had as signed (matched by sig, so a list that shifted still pairs up); a new / changed one
// is marked '(as signed)' (it is highlighted anyway). Without marks (older engine): today's state = no tags.
export function applyWrapMarks(pg, marks, isNewLeanTo = () => false) {
  try {
    if (typeof pg.ltWraps !== 'function' || typeof pg.ltWrapOf !== 'function') return
    const wr = pg.ltWraps()
    const pool = marks ? marks.lts.map((m) => ({ ...m, used: false })) : null
    pg.document.querySelectorAll('.lte.entry').forEach((el, i) => {
      if (isNewLeanTo(i)) { el.dataset.rvWrap = '(as signed)'; return }
      const now = pg.ltWrapOf(el, wr).len || 0
      let len = now
      if (pool) { const sig = ltSigOf(el); const m = pool.find((x) => !x.used && x.sig === sig); if (m) { m.used = true; len = m.len } }
      el.dataset.rvWrap = String(len || '')
    })
    pg._rvWraps = marks ? marks.active : wr.active.join(',')
  } catch (e) { console.warn('wrap marks not set', e) }
}
