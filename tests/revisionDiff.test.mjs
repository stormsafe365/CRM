// Unit tests for "Use as revision" (src/lib/revisionDiff.js).
// Run: npm test   (node --test, no dependencies)
//
// The price engine is a stand-in here (fakePrice): a toy price table with one
// cross-effect (a 10% "26GA" line on top of everything), so a change's price
// includes what it does to other lines — exactly what stepping through the
// real program does. The real CRM always prices with the quote program.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyUnit, checkSigned, diffBuilds, forwardMoney, priceChanges, r2, reopenDrift, revisionCandidates, revisionMoney, tagBuild, untag,
} from '../src/lib/revisionDiff.js'

// ── a toy engine ──────────────────────────────────────────────────────────
const DOOR = { '10x10': 1450, '12x10': 1725, '10x8': 1210 }
function fakePrice(p) {
  const f = p.fields
  let s = Number(f.bw) * Number(f.bl) * 8 + Number(f.bh) * 100
  for (const d of p.doors || []) s += (DOOR[d.rsz] || 1000) * (Number(d.rqt) || 1) + (d.rch === '1' ? 325 : 0)
  for (const w of p.wtds || []) s += w.whi === 'hiwind' ? 690 : 400
  for (const n of p.windows || []) s += (n.ntp === 'hi' ? 590 : 300) * (Number(n.nqt) || 1)
  for (const lt of p.leantos || []) s += Number(lt.ltw) * Number(lt.ltl2) * 6
  if (f.wain === 'yes') s += 500
  if (f['sheeting-upgrade'] === 'upgrade') s = s * 1.1 // cross-effect: % of everything
  return r2(s)
}
const priceOf = async (p) => fakePrice(p)

const ORIGINAL = () => ({
  version: 3, mfr: 'CCI', inputMode: false,
  fields: { bw: '30', bl: '40', bh: '12', btype: 'standard', disc: '10', tax: '7', agx: '', 'add-disc': '', 'add-disc-type': 'amt',
    cr: 'Barn Red', cw: 'White', 'sheeting-upgrade': 'upgrade', wain: 'no', cn: 'Pat Customer', notes: 'call first', 'aew-end': 'back' },
  doors: [{ rloc: 'Front Gable End', rdtype: 'rollup', rsz: '10x10', rqt: '1', rch: '0', positions: [{ val: '5', side: 'left' }], ovlSeq: 1 }],
  wtds: [{ wloc: 'Right Eave Side', whi: 'std', wqt: '1', positions: [{ val: '12', side: 'left' }], ovlSeq: 2 }],
  windows: [{ nloc: 'Left Eave Side', ntp: 'std', nqt: '1', nsill: '36', positions: [{ val: '10', side: 'left' }], ovlSeq: 3 }],
  leantos: [{ lts: 'Left', ltw: '12', ltl2: '40', lth: '8', 'lt-type': 'attached', accs: [] }],
  addcomps: [],
})
// The duplicate as the rep left it: + a 12x10 roll-up on the back, the window
// slid 6' along its wall, the lean-to removed. Customer name / notes edited too
// (never a change line).
const DUPLICATE = () => {
  const d = ORIGINAL()
  d.fields.cn = 'Pat Customer Jr.'
  d.fields.notes = 'revised 10/6'
  d.doors.push({ rloc: 'Back Gable End', rdtype: 'rollup', rsz: '12x10', rqt: '1', rch: '1', positions: [{ val: '8', side: 'left' }], ovlSeq: 4 })
  d.windows[0].positions = [{ val: '16', side: 'left' }]
  d.leantos = []
  return d
}
const TERMS = { disc: 10, tax: 7, agx: false, depPct: 17, adType: 'amt', adVal: 0 }
const fwd = (sub) => forwardMoney(sub, TERMS)

test('three changes: add roll-up, move window, remove lean-to', async () => {
  const { blockers, units } = diffBuilds(ORIGINAL(), DUPLICATE())
  assert.deepEqual(blockers, [])
  const kinds = units.map((u) => `${u.kind}:${u.cat}`).sort()
  assert.deepEqual(kinds, ['add:doors', 'move:windows', 'remove:leantos'])
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(DUPLICATE()) })
  assert.equal(res.residual, 0)
  const by = Object.fromEntries(res.lines.map((l) => [l.kind, l]))
  // remove lean-to: 12×40×6 = 2880, ×1.1 (26GA line) = 3168 credit
  assert.equal(by.remove.amount, -3168)
  // add 12x10 roll-up with chain hoist: (1725 + 325) × 1.1 = 2255
  assert.equal(by.add.amount, 2255)
  assert.equal(by.move.amount, 0)
  assert.equal(by.move.placement, true)
  assert.match(by.add.desc, /^Add roll-up door 12×10 — Back Gable End \(with chain hoist\)$/)
  assert.match(by.move.desc, /moved \(placement only\)/)
  assert.match(by.remove.desc, /^Remove lean-to/)
  // the steps add up to the program's price of the new build exactly
  const sum = res.lines.reduce((s, l) => s + l.amount, 0)
  assert.equal(r2(res.baseSub + sum), fakePrice(DUPLICATE()))
})

test('unchanged items keep the SIGNED price — only the changes are priced at today’s', async () => {
  const { units } = diffBuilds(ORIGINAL(), DUPLICATE())
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(DUPLICATE()) })
  // signed months ago, cheaper than today's price for the same build
  const todayBase = fakePrice(ORIGINAL())
  const signedSub = r2(todayBase - 1234.56)
  const sm = fwd(signedSub)
  const signed = { sub: signedSub, total: sm.adjTot, deposit: sm.dep, balance: sm.bal }
  assert.equal(checkSigned({ signed, forward: fwd }).ok, true)
  const m = revisionMoney({ signed, lines: res.lines, forward: fwd })
  // revised subtotal = signed subtotal + the changes (NOT today's price of the duplicate)
  assert.equal(m.targetSub, r2(signedSub + 2255 - 3168))
  assert.notEqual(m.targetSub, fakePrice(DUPLICATE()))
  assert.equal(r2(fakePrice(DUPLICATE()) - m.targetSub), 1234.56) // the difference is exactly the unchanged items' price drift
})

test('totals reconcile to the cent: signed total + change rows + adjustment = revised total', async () => {
  for (const terms of [TERMS, { disc: 0, tax: 0, agx: false, depPct: 17, adType: '', adVal: 0 }, { disc: 15, tax: 6.5, agx: false, depPct: 20, adType: 'pct', adVal: 35 }, { disc: 20, tax: 7, agx: true, depPct: 17, adType: 'amt', adVal: 250 }]) {
    const f = (s) => forwardMoney(s, terms)
    const { units } = diffBuilds(ORIGINAL(), DUPLICATE())
    const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(DUPLICATE()) })
    const sm = f(31337.77)
    const signed = { sub: 31337.77, total: sm.adjTot, deposit: sm.dep, balance: sm.bal }
    const m = revisionMoney({ signed, lines: res.lines, forward: f })
    const rows = res.lines.reduce((s, l) => s + l.amount, 0)
    assert.equal(r2(signed.total + rows + m.adjustment), m.total, JSON.stringify(terms))
    assert.equal(r2(signed.total + m.net), m.total)
    assert.equal(r2(m.total - m.deposit), m.balance + (terms.adType === 'pct' || terms.adVal ? 0 : 0))
    assert.equal(m.additions - m.credits, m.net)
  }
})

test('a changed component on the same wall is a change line priced old → new', async () => {
  const dup = ORIGINAL()
  dup.doors[0].rsz = '12x10'
  const { units } = diffBuilds(ORIGINAL(), dup)
  assert.equal(units.length, 1)
  assert.equal(units[0].kind, 'change')
  assert.match(units[0].desc, /size 10x10 → 12x10/)
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(dup) })
  assert.equal(res.lines[0].amount, r2((1725 - 1450) * 1.1))
})

test('field changes: size and wainscot are priced; colors priced by the engine (0 here); notes / name never listed', async () => {
  const dup = ORIGINAL()
  dup.fields.bl = '50'; dup.fields.wain = 'yes'; dup.fields.cw = 'Gray'; dup.fields.cn = 'Someone else'; dup.fields.notes = 'x'
  const { units } = diffBuilds(ORIGINAL(), dup)
  const descs = units.map((u) => u.desc)
  assert.ok(descs.includes('Building size 30×40×12 → 30×50×12'))
  assert.ok(descs.some((d) => /^Wainscot: no → yes$/.test(d)))
  assert.ok(descs.some((d) => /^Wall color: White → Gray$/.test(d)))
  assert.ok(!descs.some((d) => /Someone|notes/i.test(d)))
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(dup) })
  const size = res.lines.find((l) => l.field === 'size')
  assert.equal(size.amount, r2(30 * 10 * 8 * 1.1))
  assert.equal(res.lines.find((l) => l.field === 'cw').amount, 0)
  assert.equal(res.residual, 0)
})

test('placement-only field (storage partition position) is a $0 move', async () => {
  const dup = ORIGINAL()
  dup.fields['aew-end'] = 'front'
  const { units } = diffBuilds(ORIGINAL(), dup)
  assert.equal(units.length, 1)
  assert.equal(units[0].kind, 'move')
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(dup) })
  assert.equal(res.lines[0].amount, 0)
})

test('a step the engine cannot price stops there: that change and the rest need typed amounts', async () => {
  const { units } = diffBuilds(ORIGINAL(), DUPLICATE())
  let n = 0
  const flaky = async (p) => { n++; if (n === 2) throw new Error('boom'); return fakePrice(p) }
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf: flaky, nextSub: fakePrice(DUPLICATE()) })
  assert.equal(res.stopped, true)
  const priced = res.lines.filter((l) => !l.unpriced && !l.placement)
  assert.equal(priced.length, 0)
  assert.ok(res.lines.filter((l) => !l.placement).every((l) => l.unpriced && l.amount == null))
  assert.throws(() => revisionMoney({ signed: { sub: 1, total: 1, deposit: 0, balance: 1 }, lines: res.lines, forward: fwd }), /No amount/)
})

test('if the itemized steps do not land on the new build’s price, the gap is an unpriced line (never absorbed)', async () => {
  const { units } = diffBuilds(ORIGINAL(), DUPLICATE())
  const res = await priceChanges({ base: ORIGINAL(), units, priceOf, nextSub: fakePrice(DUPLICATE()) + 99.5 })
  const gap = res.lines.find((l) => l.kind === 'residual')
  assert.ok(gap && gap.unpriced && gap.amount == null)
  assert.equal(gap.engineDelta, 99.5)
})

test('unticked lines are left off and not charged; typed amounts on unpriced lines count', () => {
  const sm = fwd(20000)
  const signed = { sub: 20000, total: sm.adjTot, deposit: sm.dep, balance: sm.bal }
  const lines = [{ id: 'a', amount: 1000 }, { id: 'b', amount: 500, include: false }, { id: 'c', amount: '250.25', unpriced: true }]
  const m = revisionMoney({ signed, lines, forward: fwd })
  assert.equal(m.changesSub, 1250.25)
  assert.equal(m.targetSub, 21250.25)
  assert.equal(m.total, fwd(21250.25).adjTot)
})

test('no changes at all: revised = signed exactly', async () => {
  const { units } = diffBuilds(ORIGINAL(), ORIGINAL())
  assert.equal(units.length, 0)
  const sm = fwd(28888.88)
  const m = revisionMoney({ signed: { sub: 28888.88, total: sm.adjTot, deposit: sm.dep, balance: sm.bal }, lines: [], forward: fwd })
  assert.equal(m.net, 0); assert.equal(m.adjustment, 0); assert.equal(m.total, sm.adjTot); assert.equal(m.deposit, sm.dep)
})

test('blockers: terms, manufacturer, manual pricing', () => {
  const a = ORIGINAL(), b = ORIGINAL()
  b.fields.disc = '15'
  assert.match(diffBuilds(a, b).blockers.join(' '), /terms changed \(discount\)/)
  const c = ORIGINAL(); c.mfr = 'CA'
  assert.match(diffBuilds(a, c).blockers.join(' '), /manufacturer changed/)
  const d = ORIGINAL(); d.inputMode = true
  assert.match(diffBuilds(a, d).blockers.join(' '), /Input mode/)
})

test('checkSigned refuses a signed total the terms cannot reproduce', () => {
  const sm = fwd(20000)
  assert.equal(checkSigned({ signed: { sub: 20000, total: sm.adjTot, deposit: sm.dep, balance: sm.bal }, forward: fwd }).ok, true)
  assert.equal(checkSigned({ signed: { sub: 20000, total: sm.adjTot + 1, deposit: sm.dep, balance: sm.bal }, forward: fwd }).ok, false)
})

test('reopen drift (a rule rewrote the signed build) comes back as unpriced lines; placement ignored', () => {
  const saved = ORIGINAL()
  const reopened = ORIGINAL()
  reopened.fields['framing-upgrade'] = '12'; saved.fields['framing-upgrade'] = '14'
  reopened.windows[0].positions = [{ val: '10.125', side: 'left' }]
  const d = reopenDrift(saved, reopened)
  assert.equal(d.length, 1)
  assert.equal(d[0].unpriced, true)
  assert.match(d[0].desc, /^Framing gauge: 14 \(as signed\) → 12 \(today’s rules\)$/)
})

test('apply / tag round trip: applying every change to the original gives the duplicate (as priced)', () => {
  const { units } = diffBuilds(ORIGINAL(), DUPLICATE())
  let w = tagBuild(ORIGINAL())
  for (const u of units) w = applyUnit(w, u)
  const out = untag(w)
  assert.equal(fakePrice(out), fakePrice(DUPLICATE()))
  assert.equal(out.leantos.length, 0)
  assert.equal(out.doors.length, 2)
  assert.deepEqual(out.windows[0].positions, [{ val: '16', side: 'left' }])
})

test('two identical windows: one removed is one remove line, not a change', () => {
  const a = ORIGINAL(); a.windows.push({ ...a.windows[0], positions: [{ val: '20', side: 'left' }] })
  const b = ORIGINAL()
  const { units } = diffBuilds(a, b)
  assert.deepEqual(units.map((u) => u.kind), ['remove'])
})

test('step-1 list: signed / ordered first, newest first, without the duplicate itself', () => {
  const qs = [
    { id: 'dup', status: 'draft', quote_date: '2026-10-06' },
    { id: 'old', status: 'sent', quote_date: '2026-09-01' },
    { id: 'sold1', status: 'deposit_paid', quote_date: '2026-09-10' },
    { id: 'sold2', status: 'verbal_accept', quote_date: '2026-09-20' },
    { id: 'gone', status: 'deposit_paid', quote_date: '2026-09-25', deleted_at: '2026-09-26' },
  ]
  assert.deepEqual(revisionCandidates(qs, 'dup').map((c) => c.q.id), ['sold2', 'sold1', 'old'])
})
