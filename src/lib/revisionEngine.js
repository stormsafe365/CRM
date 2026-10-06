// revisionEngine.js — the browser half of "Use as revision" (lib/revisionDiff
// has the pure half). Every price here comes from the quote program itself:
//  - a hidden copy of the program (/build/quote-builder.html) reopens the
//    signed build and the new build at today's prices and steps through the
//    changes (PriceLock.snapshot().sub after each one);
//  - the signed contract's subtotal comes from its saved price snapshot, or is
//    recovered from its card totals with the program's own PriceLock.invert;
//  - the revised totals come from the program's PriceLock.forward;
//  - the live builder is then held at the revised price with the program's
//    own price lock (restoreQuoteData(data, {lock:true}) with a price
//    snapshot), so the Revised Contract it prints carries exactly those totals.

import { checkSigned, diffBuilds, priceChanges, r2, reopenDrift } from './revisionDiff'
import { isSold, savedTotalsOf, stripForDuplicate } from './priceLockCrm'

const sameCents = (a, b) => Math.abs(r2(a) - r2(b)) < 0.005
const HOLD_FIELDS = ['hold-amt', 'hold-ref', 'hold-src', 'hold-dec']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Hidden price engine ───────────────────────────────────────────────────
let frame = null
let enginePromise = null
function waitForEngine(win) {
  return new Promise((resolve, reject) => {
    let tries = 0
    const t = setInterval(() => {
      tries++
      try {
        if (win && win.document && win.document.readyState === 'complete' && typeof win.restoreQuoteData === 'function'
          && typeof win.collectQuoteData === 'function' && win.PriceLock && typeof win.PriceLock.snapshot === 'function') {
          clearInterval(t); resolve(win); return
        }
      } catch { /* keep polling */ }
      if (tries > 120) { clearInterval(t); reject(new Error('the price engine did not load')) }
    }, 250)
  })
}
export function loadRevisionEngine() {
  if (!enginePromise) {
    frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden'
    frame.src = '/build/quote-builder.html?engine=revision'
    document.body.appendChild(frame)
    enginePromise = waitForEngine(frame.contentWindow).catch((e) => { enginePromise = null; try { frame.remove() } catch { /* ignore */ } frame = null; throw e })
  }
  return enginePromise
}

export function termsOf(pg) {
  const r = (pg && pg._qTotals) || {}
  return { disc: +r.disc || 0, tax: +r.tax || 0, agx: !!r.agEx, depPct: +r.depPct || 17, adType: r.addDiscType || '', adVal: +r.addDiscVal || 0 }
}
const termsKey = (t) => JSON.stringify([+t.disc || 0, +t.tax || 0, !!t.agx, +t.depPct || 17, (+t.adVal || 0) ? String(t.adType || '') : '', +t.adVal || 0])

function cleanForEngine(payload) {
  const p = JSON.parse(JSON.stringify(payload || {}))
  delete p.priced; delete p.price_history; delete p.rendering_thumb
  p.fields = { ...(p.fields || {}) }
  HOLD_FIELDS.forEach((k) => { delete p.fields[k] })
  return p
}

// The program's option text for every select (by id and by class), so change
// lines read like the quote ("Hi-Impact 36x48" rather than a code).
function collectLabels(pg, into = {}) {
  try {
    pg.document.querySelectorAll('select').forEach((sel) => {
      const keys = [sel.id, ...String(sel.className || '').split(/\s+/)].filter(Boolean)
      ;[...sel.options].forEach((o) => {
        keys.forEach((k) => { (into[k] = into[k] || {})[o.value] = (o.textContent || '').trim() })
      })
    })
  } catch { /* labels are cosmetic */ }
  return into
}

// Reopen a build in the hidden engine at TODAY's prices (no lock) and read the
// program's building subtotal, its terms and the build as the program now sees it.
async function priceBuild(pg, payload, labels) {
  pg.restoreQuoteData(cleanForEngine(payload))
  try { if (pg._rvSnapT) { pg.clearTimeout(pg._rvSnapT); pg._rvSnapT = null } } catch { /* ignore */ }
  await wait(0)
  if (pg.INPUT_MODE === true) throw new Error('manual (Input mode) pricing')
  const snap = pg.PriceLock.snapshot()
  if (!snap || !Number.isFinite(Number(snap.sub))) throw new Error('no price')
  if (labels) collectLabels(pg, labels)
  return { sub: r2(snap.sub), hold: r2(snap.hold || 0), lines: snap.lines, terms: termsOf(pg), data: pg.collectQuoteData() }
}

// ── The signed contract ───────────────────────────────────────────────────
// { ok, sub, total, deposit, balance, terms, from, reason, notes }
export function signedOf({ original, engineTerms, pg }) {
  const p = original?.payload_json || {}
  const card = savedTotalsOf(original)
  const notes = []
  const forwardWith = (terms) => (s) => pg.PriceLock.forward(s, terms)
  const pr = p.priced
  if (pr && pr.v === 1 && Number.isFinite(Number(pr.sub)) && pr.money) {
    const f = pr.fields || {}
    const terms = { disc: +f.disc || 0, tax: +f.tax || 0, agx: !!f.agx, depPct: +pr.depPct || 17, adType: f.adType || '', adVal: +f.adVal || 0 }
    const signed = { sub: r2(pr.sub), total: r2(pr.money.adjTot), deposit: r2(pr.money.dep), balance: r2(pr.money.bal) }
    if (card && !(sameCents(card.total, signed.total) && sameCents(card.deposit, signed.deposit) && sameCents(card.balance, signed.balance))) {
      return { ok: false, reason: `The signed quote’s card (${card.total.toFixed(2)}) and its saved price snapshot (${signed.total.toFixed(2)}) disagree.` }
    }
    const chk = checkSigned({ signed, forward: forwardWith(terms) })
    return chk.ok ? { ok: true, ...signed, terms, from: 'snapshot', notes } : { ok: false, reason: chk.reason }
  }
  if (!card || !(card.total > 0)) return { ok: false, reason: 'The signed quote has no total on its card.' }
  const terms = { ...engineTerms }
  // Honor Signed Pricing on a sold order saved before price snapshots: the signed
  // contract subtotal is the target (same rule as the program's price lock).
  const honor = parseFloat((p.fields || {})['ct-honor']) || 0
  if (isSold(original.status) && honor > 0) {
    const sub = Math.round(honor)
    const m = pg.PriceLock.forward(sub, terms)
    notes.push(`Signed with Honor Signed Pricing: the signed contract is ${m.adjTot.toFixed(2)} (the card shows ${card.total.toFixed(2)}).`)
    return { ok: true, sub, total: r2(m.adjTot), deposit: r2(m.dep), balance: r2(m.bal), terms, from: 'honor', notes }
  }
  const inv = pg.PriceLock.invert(card, terms)
  if (!inv || !inv.subs || !inv.subs.length) {
    return { ok: false, reason: `The signed total ${card.total.toFixed(2)} (deposit ${card.deposit.toFixed(2)}, balance ${card.balance.toFixed(2)}) can’t be reproduced from its discount, tax and deposit settings.` }
  }
  terms.depPct = inv.depPct
  const signed = { sub: r2(inv.subs[0]), total: card.total, deposit: card.deposit, balance: card.balance }
  const chk = checkSigned({ signed, forward: forwardWith(terms) })
  return chk.ok ? { ok: true, ...signed, terms, from: 'card', notes } : { ok: false, reason: chk.reason }
}

// ── Automatic: compare the two quotes ─────────────────────────────────────
// original = the signed quotes row; livePg = the builder's program window (the
// duplicate, as edited). Returns { blockers, lines, signed, ... } — lines are
// subtotal dollars (list prices) or unpriced (typed amount required).
export async function analyzeRevision({ original, livePg, onProgress = () => {} }) {
  onProgress('Loading the price engine…')
  const eng = await loadRevisionEngine()
  const labels = {}
  const blockers = []
  const saved = original?.payload_json
  if (!saved || !saved.fields) return { blockers: ['The signed quote has no saved build to compare with.'], lines: [] }

  // The live (duplicate) build and what the builder prices it at today
  // (a reopened, held copy: its saved price minus the hold).
  const liveData = livePg.collectQuoteData()
  let liveSnap = null
  try { liveSnap = livePg.PriceLock.snapshot() } catch { liveSnap = null }
  if (!liveSnap || !Number.isFinite(Number(liveSnap.sub))) return { blockers: ['The builder has not priced this quote yet.'], lines: [] }
  if (livePg.INPUT_MODE === true) return { blockers: ['Manual (Input mode) pricing is on — the price engine can’t price the changes.'], lines: [] }
  const liveToday = r2(Number(liveSnap.sub) - Number(liveSnap.hold || 0))
  const liveTerms = termsOf(livePg)

  onProgress('Reopening the signed quote at today’s prices…')
  const baseIn = stripForDuplicate(saved, { fromQuote: original })
  let B
  try { B = await priceBuild(eng, baseIn, labels) } catch (e) { return { blockers: [`The signed quote could not be priced (${e.message || e}).`], lines: [] } }
  onProgress('Pricing this quote…')
  let N
  try { N = await priceBuild(eng, liveData, labels) } catch (e) { return { blockers: [`This quote could not be priced (${e.message || e}).`], lines: [] } }
  if (!sameCents(N.sub, liveToday)) {
    blockers.push(`The price engine prices this build at ${N.sub.toFixed(2)} but the builder shows ${liveToday.toFixed(2)} — reload the quote and try again.`)
  }
  const TERMS_MSG = 'The discount / tax / deposit terms differ from the signed quote’s. A revision keeps the signed terms — set them back to the signed quote’s in the builder, then Use as Revision again.'
  let termsBlocked = termsKey(B.terms) !== termsKey(liveTerms)
  const labelOf = (cls, v) => (labels[cls] && labels[cls][v]) || null
  const d = diffBuilds(B.data, liveData, { labelOf })
  // (diffBuilds names the terms field that changed; one message is enough)
  d.blockers.forEach((b) => { if (/order terms changed/.test(b)) termsBlocked = true; else blockers.push(b) })
  const signed = signedOf({ original, engineTerms: B.terms, pg: eng })
  if (!signed.ok) blockers.push(signed.reason)
  if (signed.ok && termsKey(signed.terms) !== termsKey(liveTerms)) termsBlocked = true
  if (termsBlocked) blockers.unshift(TERMS_MSG)
  // Compared with the build AS SIGNED (not the copy's starting point, which resets
  // a free 26GA auto-upgrade that the program then re-applies when it still qualifies).
  const drift = reopenDrift(saved, B.data, { labelOf })
  if (blockers.length) return { blockers: [...new Set(blockers)], termsBlocked, lines: [], signed }

  const priced = await priceChanges({
    base: B.data, units: d.units, nextSub: N.sub,
    priceOf: async (p) => (await priceBuild(eng, p)).sub,
    onStep: (i, n) => onProgress(`Pricing change ${i + 1} of ${n}…`),
  })
  if (!sameCents(priced.baseSub, B.sub)) {
    return { blockers: [`The price engine did not reopen the signed build at the same price twice (${B.sub.toFixed(2)} / ${priced.baseSub.toFixed(2)}).`], lines: [], signed }
  }
  return {
    blockers: [], signed, terms: signed.terms, forward: (s) => eng.PriceLock.forward(s, signed.terms),
    baseToday: B.sub, nextToday: N.sub, residual: priced.residual,
    lines: [...drift, ...priced.lines],
    origDims: [B.data.fields.bw, B.data.fields.bl, B.data.fields.bh].join('x'),
    aewChanged: d.units.some((u) => u.field && /^aew-|add-end-wall/.test(u.field)),
  }
}

// Manual path: only the signed contract's figures are needed.
export async function analyzeSignedOnly({ original, livePg, onProgress = () => {} }) {
  onProgress('Loading the price engine…')
  const eng = await loadRevisionEngine()
  const saved = original?.payload_json
  if (!saved || !saved.fields) {
    return { blockers: ['The signed quote has no saved build, so the revised contract can’t be held at its signed price. Use the Revision Order on the signed quote’s card instead.'] }
  }
  let B
  try { B = await priceBuild(eng, stripForDuplicate(saved, { fromQuote: original })) } catch (e) { return { blockers: [`The signed quote could not be priced (${e.message || e}).`] } }
  const signed = signedOf({ original, engineTerms: B.terms, pg: eng })
  if (!signed.ok) return { blockers: [signed.reason] }
  const liveTerms = termsOf(livePg)
  if (termsKey(signed.terms) !== termsKey(liveTerms)) {
    return { blockers: ['The discount / tax / deposit terms differ from the signed quote’s — a revision keeps the signed terms. Set them back first.'], signed }
  }
  // What this quote adds / changes (for the Revised Contract's highlights only — no prices).
  let newItems = {}, aewChanged = false
  try {
    const d = diffBuilds(B.data, livePg.collectQuoteData())
    newItems = newItemsOf(d.units)
    aewChanged = d.units.some((u) => u.field && /^aew-|add-end-wall/.test(u.field))
  } catch { /* highlights are cosmetic */ }
  return {
    blockers: [], signed, terms: signed.terms, forward: (s) => eng.PriceLock.forward(s, signed.terms),
    origDims: [B.data.fields.bw, B.data.fields.bl, B.data.fields.bh].join('x'), newItems, aewChanged, baseToday: B.sub,
  }
}

// Which components of the new build to highlight on the Revised Contract:
// {doors:[index…], …} for added / changed ones (moves are not highlighted).
export function newItemsOf(lines) {
  const out = {}
  for (const l of lines || []) {
    if (l.include === false || !(l.kind === 'add' || l.kind === 'change') || !Number.isInteger(l.nextIndex)) continue
    ;(out[l.cat] = out[l.cat] || []).push(l.nextIndex)
  }
  return out
}

// ── Hold the live builder at the revised price ────────────────────────────
// Reopens the builder's current build with a price snapshot at the revised
// subtotal (the program's own price lock holds it, exactly like reopening a
// saved quote). Then marks what the signed order had, so the Revised Contract
// highlights only the changes and shows the signed deposit as paid.
// Returns { ok, reason, screen }.
const ENTRY_SEL = { doors: '.re.entry', wtds: '.we.entry', windows: '.ne.entry', addcomps: '.ace.entry', leantos: '.lte.entry' }
export function holdBuilderAt({ pg, targetSub, money, terms, status, signed, origDims, newItems = {}, aewChanged = false, baseToday = null }) {
  const data = pg.collectQuoteData()
  let snap = null
  try { snap = pg.PriceLock.snapshot() } catch { snap = null }
  const now = new Date().toISOString()
  data.savedAt = now
  data.priced = {
    v: 1, pricedAt: now, engineRev: pg.PriceLock.ENGINE_REV, inputMode: false, source: 'held',
    sub: r2(targetSub), hold: 0, holdParts: [], depPct: terms.depPct || 17,
    freeThresh: (snap && snap.freeThresh) || 10000, free: (snap && snap.free) || { sheet: false, fastener: false },
    thrPre: snap ? snap.thrPre : null, firstPricedAt: now,
    fields: { disc: terms.disc, tax: terms.tax, agx: !!terms.agx, adType: terms.adType, adVal: terms.adVal },
    money: { da: money.da, ad: money.ad, ta: money.ta, tot: money.tot, grossDep: money.grossDep, addDisc: money.addDisc, dep: money.dep, bal: money.bal, adjTot: money.adjTot },
  }
  pg.restoreQuoteData(data, { lock: true, status })
  try { if (pg._rvSnapT) { pg.clearTimeout(pg._rvSnapT); pg._rvSnapT = null } } catch { /* ignore */ }
  const st = pg.PriceLock.state() || {}
  const G = (id) => { try { return Number(String(pg.G(id).textContent).replace(/[^0-9.-]/g, '')) } catch { return NaN } }
  const screen = { total: G('ptot'), deposit: G('pdep'), balance: G('pbal') }
  const exact = sameCents(screen.total, money.adjTot) && sameCents(screen.deposit, money.dep) && sameCents(screen.balance, money.bal)
  if (!st.active || !st.ok || (st.issues || []).length || !exact) {
    return { ok: false, screen, reason: (st.issues || [])[0] || `The builder could not hold the revised price exactly (it shows ${screen.total.toFixed(2)}, expected ${r2(money.adjTot).toFixed(2)}).` }
  }
  // Name the held difference on the customer's documents. The program prints it
  // as "Pricing as originally quoted"; that is exactly right for the unchanged
  // items (signed price − today's price of the signed build). Anything beyond
  // that (typed amounts, a change left off / not charged) gets its own row.
  try {
    const liveToday = snap ? r2(Number(snap.sub) - Number(snap.hold || 0)) : null
    const all = liveToday == null ? 0 : r2(targetSub - liveToday)
    const h = r2(st.hold || 0)
    if (baseToday != null && Number.isFinite(Number(baseToday)) && Math.abs(all) >= 0.005 && h) {
      const orig = r2(Number(signed.sub) - Number(baseToday))
      const p1 = r2(h * (orig / all))
      const p2 = r2(h - p1)
      if (Math.abs(p2) >= 0.005) {
        const parts = [
          ...(Math.abs(p1) >= 0.005 ? [{ k: 'orig', label: 'Pricing as originally quoted', amt: p1, rules: [] }] : []),
          { k: 'rev', label: 'Revision pricing (as agreed)', amt: p2, rules: [] },
        ]
        const ref = pg.G('hold-ref')
        if (ref) ref.value = JSON.stringify({ parts })
        if (pg.PriceLock.st) pg.PriceLock.st.parts = parts
        pg.rc()
      }
    }
  } catch (e) { console.warn('hold rows not named', e) }
  // What the signed order had (no highlight) vs what this revision adds / changes.
  try {
    pg._rvOrig = { tot: r2(signed.total), dep: r2(signed.deposit), dims: origDims }
    for (const kind of Object.keys(ENTRY_SEL)) {
      const isNew = new Set(newItems[kind] || [])
      pg.document.querySelectorAll(ENTRY_SEL[kind]).forEach((el, i) => {
        if (isNew.has(i)) { delete el.dataset.rvOrig; if (kind === 'leantos') el.dataset.rvStor = '(as signed)' }
        else {
          el.dataset.rvOrig = '1'
          if (kind === 'leantos') { try { el.dataset.rvStor = pg.ltStorSig(el) } catch { /* ignore */ } }
        }
      })
    }
    try { pg._rvAewSig = aewChanged ? '(as signed)' : (typeof pg.aewSig === 'function' ? pg.aewSig() : null) } catch { /* ignore */ }
  } catch (e) { console.warn('revision marks failed', e) }
  return { ok: true, screen, state: st }
}
