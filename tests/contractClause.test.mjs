// The contract's conditional clause (owner 11/2/26: "once we click generate contract there should be an option to 'add
// conditional clause' & then why its conditional - again in his case its conditional upon permitting").
// Run: npm test   (node --test, no dependencies)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyClauseToProgram, clauseFields, clauseFromProgram, clauseLabel, clauseOfFields, clauseReady, normClause, payloadWithClause, sameClause,
} from '../src/lib/contractClause.js'
import { diffBuilds } from '../src/lib/revisionDiff.js'

test('a clause is kept tidy: three kinds, the words only for "something else"', () => {
  assert.deepEqual(normClause({ kind: 'permit', why: 'ignored' }), { kind: 'permit', why: '' })
  assert.deepEqual(normClause({ kind: 'other', why: '  the   buyer’s financing  ' }), { kind: 'other', why: 'the buyer’s financing' })
  assert.deepEqual(normClause({ kind: 'hoa' }), { kind: '', why: '' })
  assert.deepEqual(normClause(null), { kind: '', why: '' })
  assert.equal(normClause({ kind: 'other', why: 'x'.repeat(400) }).why.length, 160)
  assert.equal(clauseReady({ kind: 'other', why: '  ' }), false)
  assert.equal(clauseReady({ kind: 'other', why: 'financing' }), true)
  assert.equal(clauseReady({ kind: 'permit' }), true)
  assert.equal(clauseReady({ kind: '' }), true)
})

test('saved fields: a quote saved before the option has no clause; the two fields round-trip', () => {
  assert.deepEqual(clauseOfFields({ bw: '24' }), { kind: '', why: '' })
  assert.deepEqual(clauseOfFields(undefined), { kind: '', why: '' })
  assert.deepEqual(clauseFields({ kind: 'permit' }), { 'ct-cond': 'permit', 'ct-cond-why': '' })
  assert.deepEqual(clauseOfFields(clauseFields({ kind: 'other', why: 'HOA approval' })), { kind: 'other', why: 'HOA approval' })
  assert.equal(sameClause({ kind: 'permit', why: 'a' }, { kind: 'permit' }), true)
  assert.equal(sameClause({ kind: 'other', why: 'a' }, { kind: 'other', why: 'b' }), false)
})

test('payloadWithClause: writes only the two fields, the same object when nothing changes', () => {
  const p = { version: 3, fields: { bw: '24', 'ct-cond': 'permit', 'ct-cond-why': '' }, doors: [] }
  assert.equal(payloadWithClause(p, { kind: 'permit' }), p)
  const q = payloadWithClause(p, { kind: 'other', why: 'financing' })
  assert.notEqual(q, p)
  assert.deepEqual(q.fields, { bw: '24', 'ct-cond': 'other', 'ct-cond-why': 'financing' })
  assert.equal(q.doors, p.doors)
  assert.deepEqual(payloadWithClause({ fields: { bw: '24' } }, { kind: '' }).fields, { bw: '24', 'ct-cond': '', 'ct-cond-why': '' })
})

test('the words for a toast', () => {
  assert.equal(clauseLabel({ kind: 'permit' }, 'Volusia'), 'conditional upon permit approval (Volusia County)')
  assert.equal(clauseLabel({ kind: 'permit' }, 'Volusia County'), 'conditional upon permit approval (Volusia County)')
  assert.equal(clauseLabel({ kind: 'other', why: 'financing' }), 'conditional upon financing')
  assert.equal(clauseLabel({ kind: '' }), 'no conditional clause')
})

test('in the program window: read and write the Section 14 fields (an older program is not asked)', () => {
  const els = { 'ct-cond': { value: '' }, 'ct-cond-why': { value: 'stale' } }
  let ui = 0
  const pg = { document: { getElementById: (id) => els[id] || null }, ctCondUi: () => { ui++ } }
  assert.deepEqual(clauseFromProgram(pg), { kind: '', why: '' })
  assert.equal(applyClauseToProgram(pg, { kind: 'permit', why: 'x' }), true)
  assert.equal(els['ct-cond'].value, 'permit')
  assert.equal(els['ct-cond-why'].value, '')
  assert.equal(ui, 1)
  applyClauseToProgram(pg, { kind: 'other', why: 'the bank’s loan approval' })
  assert.deepEqual(clauseFromProgram(pg), { kind: 'other', why: 'the bank’s loan approval' })
  const old = { document: { getElementById: () => null } }
  assert.equal(clauseFromProgram(old), null)
  assert.equal(applyClauseToProgram(old, { kind: 'permit' }), false)
})

test('Use as revision: the clause is a contract term, never a build change', () => {
  const base = { version: 3, mfr: 'CCI', fields: { bw: '24', bl: '35', bh: '12', btype: 'standard', disc: '20', tax: '6.5' }, doors: [], wtds: [], windows: [], leantos: [], addcomps: [] }
  const next = JSON.parse(JSON.stringify(base))
  next.fields['ct-cond'] = 'other'
  next.fields['ct-cond-why'] = 'financing'
  const d = diffBuilds(base, next)
  assert.deepEqual(d.blockers, [])
  assert.deepEqual(d.units, [])
})

// ── the real quote program (public/build/quote-builder.html): its clause words ──
const PROGRAM = readFileSync(new URL('../public/build/quote-builder.html', import.meta.url), 'latin1')
const grab = (name) => {
  const i = PROGRAM.indexOf(`function ${name}(`)
  assert.ok(i > 0, `${name} is in the program`)
  let depth = 0
  for (let j = PROGRAM.indexOf('{', i); j < PROGRAM.length; j++) {
    if (PROGRAM[j] === '{') depth++
    else if (PROGRAM[j] === '}' && --depth === 0) return Buffer.from(PROGRAM.slice(i, j + 1), 'latin1').toString('utf8')
  }
  throw new Error(name)
}
const ctCondTerms = new Function(`${grab('ctCondTerms')}; return ctCondTerms`)()

test('program: permit approval - the owner’s terms for Reginald (11/2/26), county / deposit / fees filled in', () => {
  const t = ctCondTerms({ kind: 'permit', why: '', county: 'Volusia', deposit: '$2,582.00', plans: { label: 'Site Specific Plans', cost: '1000' }, permSvc: { label: 'Building Permit Service', amt: '300' } })
  assert.equal(t.title, 'Conditional upon permit approval')
  assert.equal(t.summary, 'CONDITIONAL UPON PERMIT APPROVAL: if Volusia County denies the building permit, the deposit is refunded as set out in Addendum A (attached).')
  const all = t.items.map(([h, x]) => h + ' ' + x).join('\n')
  assert.equal(t.items.length, 8)
  assert.match(all, /If Volusia County denies the building permit in writing, Buyer may cancel/)
  assert.match(all, /refund Buyer's deposit in full \(\$2,582\.00\) within 30 days/)
  assert.match(all, /Approval of the permit with conditions or required changes .* is not a denial/)
  assert.match(all, /The Site Specific Plans \(\$1000\) and the Building Permit Service \(\$300\) are invoiced separately by the engineering firm, are used to apply for the permit, and are not refunded\./)
  assert.match(all, /within 30 days of signing/)
  assert.match(all, /until Volusia County issues or denies the permit/)
  assert.match(all, /places the order with the manufacturer after signing so the engineered plans needed for the permit application can be prepared/)
  assert.match(all, /controls over any conflicting term/)
})

test('program: permit approval without plans / permit service, and an unknown county', () => {
  const t = ctCondTerms({ kind: 'permit', county: '—', deposit: '$1,000.00', plans: null, permSvc: null })
  const all = t.items.map(([h, x]) => h + ' ' + x).join('\n')
  assert.match(t.summary, /if the county building department denies/)
  assert.match(all, /Not refunded\. Any fees charged by the building department remain Buyer's responsibility\./)
  assert.match(all, /after signing\. This does not change/)
  const one = ctCondTerms({ kind: 'permit', county: 'Lee County', deposit: '$1.00', plans: { label: 'Generic Plans', cost: '175' }, permSvc: null })
  assert.match(one.summary, /if Lee County denies/)
  assert.match(one.items[3][1], /^The Generic Plans \(\$175\) is invoiced separately by the engineering firm, is used to apply for the permit, and is not refunded\./)
})

test('program: something else - the typed words, the same refund terms', () => {
  const t = ctCondTerms({ kind: 'other', why: "the buyer's financing being approved by the bank.", county: 'Volusia', deposit: '$2,582.00', plans: { label: 'Site Specific Plans', cost: '1000' }, permSvc: null })
  assert.equal(t.title, "Conditional upon the buyer's financing being approved by the bank")
  assert.equal(t.summary, "CONDITIONAL UPON THE BUYER'S FINANCING BEING APPROVED BY THE BANK: if this condition is not met, the deposit is refunded as set out in Addendum A (attached).")
  assert.deepEqual(t.items.map((x) => x[0]), ['Conditional upon.', 'Deposit refund if the condition is not met.', 'Not refunded.', "Buyer's part.", 'How long this lasts.', 'Order placed at signing.', 'This Addendum controls.'])
  assert.equal(t.items[0][1], "This Agreement is conditional upon the buyer's financing being approved by the bank.")
  assert.equal(t.items[2][1], 'The Site Specific Plans ($1000) is invoiced separately by the engineering firm and is not refunded.')
  assert.match(t.items[1][1], /\(\$2,582\.00\) within 30 days/)
  const bare = ctCondTerms({ kind: 'other', why: 'HOA approval', county: '', deposit: '$5.00', plans: null, permSvc: null })
  assert.equal(bare.items.length, 6) // no fees line
})
