// Unit tests for "Save as a new quote" in the Build Quote modal (src/lib/saveAsNew.js, owner 10/24/26: she tweaked a
// saved quote and wanted to keep BOTH versions). Run: npm test   (node --test, no dependencies)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AS_SOLD_FIELDS, QUOTE_NUMBER_RE, buildSignature, finishProgramForNewQuote, newQuoteNumber, prepareProgramForNewQuote,
  saveAsNewBlocker, saveAsNewConfirm, saveAsNewProblems, saveAsNewRow, unsavedCheck, unsavedMessage,
} from '../src/lib/saveAsNew.js'
import { planQuoteFields, restoreOptionsFor } from '../src/lib/priceLockCrm.js'
import { CRM_PAYLOAD_KEYS, contractNumberFor, agreementRootOf } from '../src/lib/contractDocs.js'

const NOW = new Date('2026-10-24T15:30:00-04:00')

// The quote she reopened: a SIGNED order (contract sent, executed, revised once), held at its saved price,
// with price history, a grandfathered 12GA rule, Honor Signed Pricing and a star.
function signedOriginal() {
  return {
    id: 'q-orig', client_id: 'c-1', created_by: 'u-owner', created_at: '2026-09-17T14:00:00Z', updated_at: '2026-10-20T10:00:00Z',
    quote_number: 'SS-2026-05670', quote_date: '2026-09-17', status: 'deposit_paid', valid_through: '2026-10-17', notes: 'Pad poured 10/2',
    total_amount: 44448, deposit_amount: 5222, balance_amount: 39226, pdf_snapshot_url: 'c-1/quote/SS-2026-05670.pdf',
    starred: true, parent_quote_id: 'q-older', manufacturer: 'cci', building_summary: '30x50x14 vertical · 2 RU', building_size: '30x50x14',
    payload_json: {
      version: 3, savedAt: '2026-09-17T14:00:00Z', mfr: 'CCI', quote_number: 'SS-2026-05670', source: '3d-builder',
      fields: { bw: '30', bl: '50', bh: '14', 'hold-amt': '903', 'hold-ref': '{"parts":[]}', 'hold-src': 'legacy|2026-10-05', 'hold-dec': '[{"rule":"hw-12ga","choice":"keep"}]', 'ct-honor': '44448', 'ct-honor-ref': 'SS-2026-05670' },
      overrides: { fu14: true, imp: false, lap: false, ns: false, pbRule: 1, grand: { fu14: true, imp: false, lap: false, ns: false } },
      priced: { v: 1, source: 'held', sub: 38000, hold: 903, holdParts: [{ k: 'orig', amt: 903 }], pricedAt: '2026-09-17T14:00:00Z', firstPricedAt: '2026-09-17T14:00:00Z', money: { adjTot: 44448, dep: 5222, bal: 39226 } },
      totals: { total: 44448, deposit: 5222, balance: 39226 },
      price_history: [{ at: '2026-09-17T14:00:00Z', total: 44000, pdf: 'c-1/quote/old.pdf' }],
      contractSent: { at: '2026-09-18T10:00:00Z', number: 'SS-2026-05670' },
      executed: { at: '2026-09-20', signedOn: '2026-09-20', confirmed: true },
      revisionOf: { id: 'q-older', quote_number: 'SS-2026-04000', rev_no: '1', agreement_number: 'SS-2026-04000' },
      revisedBy: null, revisions: [{ id: 'q-x' }],
      duplicatedFrom: { id: 'q-older', quote_number: 'SS-2026-04000', at: '2026-09-17T13:00:00Z' },
      priceFresh: true, freshBasis: { total: 1, deposit: 0, balance: 1 },
      rendering_thumb: 'data:image/jpeg;base64,AAA',
    },
  }
}

// What lib/builderSave harvestAndSaveQuote hands onSave for a BRAND-NEW quote (initialQuote: null), after the
// program was switched to today's pricing (PriceLock.freshen): hold fields empty, flags off, engine snapshot.
function harvestedNew({ number = 'SS-2026-71234', total = 46120.5, deposit = 5418.66, balance = 40701.84 } = {}) {
  return {
    quote_date: NOW.toISOString().slice(0, 10),
    quote_number: number, manufacturer: 'cci', building_summary: '30x50x14 vertical · 3 RU', building_size: '30x50x14',
    total_amount: total, deposit_amount: deposit, balance_amount: balance,
    ...planQuoteFields({ initialQuote: null, now: NOW }),
    pdf_snapshot_url: `c-1/quote/${number}.pdf`,
    payload_json: {
      version: 3, savedAt: NOW.toISOString(), mfr: 'CCI', source: '3d-builder', quote_number: number,
      fields: { bw: '30', bl: '50', bh: '14', 'hold-amt': '', 'hold-ref': '', 'hold-src': '', 'hold-dec': '', 'ct-honor': '', 'ct-honor-ref': '' },
      doors: [{ rloc: 'Front Gable End', rsz: '10x10' }, { rloc: 'Left Side', rsz: '10x10' }, { rloc: 'Left Side', rsz: '9x8' }],
      overrides: { fu14: false, imp: false, lap: false, ns: false, pbRule: 1, cpOnce: 1, grand: { fu14: false, imp: false, lap: false, ns: false } },
      sessionEdits: [],
      priced: { v: 1, source: 'engine', sub: 39400, hold: 0, holdParts: [], pricedAt: NOW.toISOString(), firstPricedAt: '2026-09-17T14:00:00Z', money: { adjTot: total, dep: deposit, bal: balance } },
      totals: { total, deposit, balance },
      manufacturer: 'cci', building_summary: '30x50x14 vertical · 3 RU', rendering_thumb: 'data:image/jpeg;base64,BBB',
    },
  }
}

test('save as new: a NEW row for the lead at the program\'s price — nothing of the original\'s price, marks or links', () => {
  const original = signedOriginal()
  const before = structuredClone(original)
  const payload = harvestedNew()
  const row = saveAsNewRow({ payload, original, clientId: 'c-1', userId: 'u-rep', now: NOW })

  // a new row (no id), the lead, who made it
  assert.equal(row.id, undefined)
  assert.equal(row.client_id, 'c-1')
  assert.equal(row.created_by, 'u-rep')
  // new number (the printed quote's), today's date, draft, valid 30 days, no notes, unstarred, its own PDF
  assert.equal(row.quote_number, 'SS-2026-71234')
  assert.notEqual(row.quote_number, original.quote_number)
  assert.match(row.quote_number, QUOTE_NUMBER_RE)
  assert.equal(row.payload_json.quote_number, row.quote_number)
  assert.equal(row.quote_date, '2026-10-24')
  assert.equal(row.status, 'draft')
  assert.equal(row.valid_through, new Date(NOW.getTime() + 30 * 86400000).toISOString().slice(0, 10))
  assert.equal(row.notes, null)
  assert.equal(row.starred, false)
  assert.equal(row.pdf_snapshot_url, 'c-1/quote/SS-2026-71234.pdf')
  assert.equal(row.parent_quote_id, undefined) // never a revision link
  // priced exactly as the program showed (never the original's saved price)
  assert.equal(row.total_amount, 46120.5)
  assert.equal(row.deposit_amount, 5418.66)
  assert.equal(row.balance_amount, 40701.84)
  assert.deepEqual(row.payload_json.totals, { total: 46120.5, deposit: 5418.66, balance: 40701.84 })
  assert.equal(row.payload_json.priced.source, 'engine')
  assert.equal(row.payload_json.priced.hold, 0)
  assert.equal(row.payload_json.priced.firstPricedAt, NOW.toISOString()) // first priced NOW, not the original's day
  // none of the original's marks, links, history or held-price fields
  for (const k of [...CRM_PAYLOAD_KEYS, 'price_history', 'priceFresh', 'freshBasis']) assert.equal(k in row.payload_json, false, k)
  for (const k of AS_SOLD_FIELDS) assert.equal(k in row.payload_json.fields, false, k)
  assert.equal(row.payload_json.rendering_thumb, 'data:image/jpeg;base64,BBB') // the NEW build's picture
  assert.ok(!JSON.stringify(row).includes('44448'), 'the original price appears nowhere in the new row')
  // the link back to the original (Use as Revision preselects it)
  assert.deepEqual(row.payload_json.duplicatedFrom, { id: 'q-orig', quote_number: 'SS-2026-05670', at: NOW.toISOString(), via: 'save-as-new' })
  // the build itself is the program's
  assert.equal(row.payload_json.doors.length, 3)
  // ...and the ORIGINAL is untouched
  assert.deepEqual(original, before)
  // the input payload is not mutated either
  assert.equal(payload.payload_json.fields['hold-amt'], '')
})

test('save as new: the new quote is a plain new quote to the rest of the CRM', () => {
  const row = saveAsNewRow({ payload: harvestedNew(), original: signedOriginal(), clientId: 'c-1', userId: 'u-rep', now: NOW })
  // reopens at ITS saved price (its own snapshot) — not priced fresh like an unsaved duplicate
  assert.deepEqual(restoreOptionsFor({ ...row, id: 'q-new' }), { lock: true, status: 'draft' })
  // its contract carries its own number, not the original's agreement / revision number
  assert.equal(contractNumberFor({ ...row, id: 'q-new' }), 'SS-2026-71234')
  assert.equal(agreementRootOf({ ...row, id: 'q-new' }), 'SS-2026-71234')
})

test('save as new: refuses a payload that still carries the original\'s held / signed price (nothing inserted)', () => {
  const held = harvestedNew()
  held.payload_json.fields['hold-amt'] = '903'
  held.payload_json.fields['hold-src'] = 'legacy|2026-10-05'
  assert.throws(() => saveAsNewRow({ payload: held, original: signedOriginal(), clientId: 'c-1', now: NOW }), /holds the original’s saved price/)
  const snap = harvestedNew()
  snap.payload_json.priced = { ...snap.payload_json.priced, source: 'held', hold: 903 }
  assert.throws(() => saveAsNewRow({ payload: snap, original: signedOriginal(), clientId: 'c-1', now: NOW }), /snapshot is still the held price/)
  const gf = harvestedNew()
  gf.payload_json.overrides = { ...gf.payload_json.overrides, fu14: true, grand: { fu14: true } }
  assert.throws(() => saveAsNewRow({ payload: gf, original: signedOriginal(), clientId: 'c-1', now: NOW }), /grandfathered rule/)
  const honor = harvestedNew()
  honor.payload_json.fields['ct-honor'] = '44448'
  assert.throws(() => saveAsNewRow({ payload: honor, original: signedOriginal(), clientId: 'c-1', now: NOW }), /Honor Signed Pricing/)
  const dec = harvestedNew()
  dec.payload_json.fields['hold-dec'] = '[{"rule":"hw-12ga"}]'
  assert.deepEqual(saveAsNewProblems(dec.payload_json), ['the original’s rule decisions are still applied'])
  // a clean harvest has none
  assert.deepEqual(saveAsNewProblems(harvestedNew().payload_json), [])
  // a rep's own override (no grandfathering) is the rep's term, not the original's held price
  const own = harvestedNew()
  own.payload_json.overrides.fu14 = true
  assert.deepEqual(saveAsNewProblems(own.payload_json), [])
  // no lead / no price: refused
  assert.throws(() => saveAsNewRow({ payload: harvestedNew(), original: signedOriginal(), clientId: null, now: NOW }), /Pick a lead/)
  assert.throws(() => saveAsNewRow({ payload: harvestedNew({ total: 0 }), original: signedOriginal(), clientId: 'c-1', now: NOW }), /No price yet/)
})

test('save as new: a new number in the SS-YYYY-xxxxx format, never the original\'s', () => {
  const t = new Date('2026-10-24T19:01:12.345Z')
  assert.equal(newQuoteNumber(t), `SS-2026-${String(t.getTime()).slice(-5)}`)
  const same = `SS-2026-${String(t.getTime()).slice(-5)}`
  const n = newQuoteNumber(t, [same])
  assert.match(n, QUOTE_NUMBER_RE)
  assert.notEqual(n, same)
  // the printed number happens to equal the original's, or is missing / malformed: a fresh one
  const orig = { ...signedOriginal(), quote_number: 'SS-2026-71234' }
  const r1 = saveAsNewRow({ payload: harvestedNew({ number: 'SS-2026-71234' }), original: orig, clientId: 'c-1', now: t })
  assert.notEqual(r1.quote_number, 'SS-2026-71234')
  assert.match(r1.quote_number, QUOTE_NUMBER_RE)
  assert.equal(r1.payload_json.quote_number, r1.quote_number)
  const bad = harvestedNew(); bad.quote_number = null
  assert.match(saveAsNewRow({ payload: bad, original: signedOriginal(), clientId: 'c-1', now: t }).quote_number, QUOTE_NUMBER_RE)
  // a lead without the starred column: none written (like Duplicate)
  const { starred, ...noStar } = signedOriginal()
  assert.equal('starred' in saveAsNewRow({ payload: harvestedNew(), original: noStar, clientId: 'c-1', now: NOW }), false)
})

test('save as new: when it is offered', () => {
  const o = signedOriginal()
  assert.equal(saveAsNewBlocker({ original: o }), null)                       // a signed order: allowed (a new draft)
  assert.equal(saveAsNewBlocker({ original: { ...o, status: 'draft', payload_json: { fields: {} } } }), null)
  assert.match(saveAsNewBlocker({ original: null }), /Save this quote first/)
  assert.match(saveAsNewBlocker({ original: o, revisionChanges: { rows: [{ type: 'add' }] } }), /Not during a revision/)
  assert.match(saveAsNewBlocker({ original: { ...o, payload_json: { ...o.payload_json, sessionEdits: [{ kind: 'cell' }] } } }), /Pricing-tab price edits/)
  assert.equal(saveAsNewBlocker({ original: { ...o, payload_json: { ...o.payload_json, sessionEdits: [] } } }), null)
})

test('save as new: the confirm when today\'s pricing moved the price on screen', () => {
  const c = saveAsNewConfirm({ original: signedOriginal(), before: { total: 45351, deposit: 5329, balance: 40022 }, after: { total: 46120.5, deposit: 5418.66, balance: 40701.84 } })
  assert.equal(c.confirm, true)
  assert.equal(c.okLabel, 'Save as new quote')
  assert.deepEqual(c.lines[0], { label: 'Total', from: 44448, to: 46120.5, delta: 1672.5 })
  assert.match(c.notes.join(' '), /held on screen was \$45,351\.00, today’s pricing for this build is \$46,120\.50 \(\+\$769\.50\)/)
  assert.match(c.notes.join(' '), /#SS-2026-05670 stays exactly as it is \(\$44,448\.00\)/)
})

test('Done: unsaved changes = the price or the build moved since it was opened / saved', () => {
  const saved = { total: 44448, deposit: 5222, balance: 39226 }
  const sig = buildSignature({ fields: { bw: '30' }, doors: [], savedAt: 'a', priced: { sub: 1 } })
  assert.equal(sig, buildSignature({ fields: { bw: '30' }, doors: [], savedAt: 'b', priced: { sub: 2 } })) // time stamp / snapshot ignored
  assert.deepEqual(unsavedCheck({ baseline: sig, sig, saved, screen: { ...saved } }).dirty, false)
  const moved = unsavedCheck({ baseline: sig, sig, saved, screen: { total: 45000, deposit: 5300, balance: 39700 } })
  assert.equal(moved.dirty, true); assert.equal(moved.priceMoved, true)
  assert.match(unsavedMessage({ quoteNumber: 'SS-2026-05670', check: moved }), /^Close without saving\? The price on screen is \$45,000\.00, quote #SS-2026-05670 is saved at \$44,448\.00\./)
  const built = unsavedCheck({ baseline: sig, sig: buildSignature({ fields: { bw: '40' }, doors: [] }), saved, screen: { ...saved } })
  assert.equal(built.dirty, true); assert.equal(built.buildChanged, true); assert.equal(built.priceMoved, false)
  assert.match(unsavedMessage({ quoteNumber: 'SS-2026-05670', check: built }), /The build on screen has changes that are not in quote #SS-2026-05670/)
  // an honored sold order: the builder holds the SIGNED price, not the card's — that is not a change
  const lock = { requested: true, ready: true, active: true, ok: true, choice: 'keep', source: 'legacy+honor', saved: { total: 44000, deposit: 5222, balance: 38778 } }
  assert.equal(unsavedCheck({ baseline: sig, sig, saved, screen: { total: 44000, deposit: 5222, balance: 38778 }, lock }).dirty, false)
  // no baseline yet (program not read): only the price counts
  assert.equal(unsavedCheck({ baseline: null, sig: 'x', saved, screen: { ...saved } }).dirty, false)
})

test('program helpers: switch a reopened quote to today\'s pricing, then drop its revision baseline', () => {
  // a stand-in program window: PriceLock.freshen() drops the hold (screen +$769.50)
  const els = { ptot: { textContent: '$45,351.00' }, pdep: { textContent: '$5,329.00' }, pbal: { textContent: '$40,022.00' }, 'ct-honor': { value: '44448' }, 'ct-honor-ref': { value: 'SS-2026-05670' } }
  let fresh = 0, cleared = 0
  const pg = {
    document: { getElementById: (id) => els[id] || null },
    PriceLock: { st: { requested: true }, freshen() { fresh++; els.ptot.textContent = '$46,120.50'; els.pdep.textContent = '$5,418.66'; els.pbal.textContent = '$40,701.84'; return true } },
    _rvClear() { cleared++ },
  }
  const r = prepareProgramForNewQuote(pg)
  assert.equal(r.ok, true); assert.equal(r.freshened, true); assert.equal(r.honored, true); assert.equal(fresh, 1)
  assert.deepEqual(r.before, { total: 45351, deposit: 5329, balance: 40022 })
  assert.deepEqual(r.after, { total: 46120.5, deposit: 5418.66, balance: 40701.84 })
  assert.equal(els['ct-honor'].value, ''); assert.equal(els['ct-honor-ref'].value, '')
  assert.equal(finishProgramForNewQuote(pg), true); assert.equal(cleared, 1)
  // never reopened (no PriceLock.st): nothing held, nothing to switch
  const pg2 = { document: { getElementById: (id) => ({ ptot: { textContent: '$9,000.00' }, pdep: { textContent: '$1,530.00' }, pbal: { textContent: '$7,470.00' } })[id] || null }, PriceLock: { st: null, freshen() { throw new Error('no') } } }
  const r2 = prepareProgramForNewQuote(pg2)
  assert.equal(r2.ok, true); assert.equal(r2.freshened, false); assert.deepEqual(r2.before, r2.after)
  // freshen failing = not saved
  const pg3 = { ...pg, PriceLock: { st: {}, freshen() { throw new Error('boom') } } }
  assert.equal(prepareProgramForNewQuote(pg3).ok, false)
})

test('the modal: Save as new saves a brand-new quote and its later Updates go to the NEW row', () => {
  const src = readFileSync(new URL('../src/components/BuildQuoteModal.jsx', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('async function saveAsNew()'), src.indexOf('async function saveToLead()'))
  assert.ok(fn.length > 500, 'saveAsNew found')
  assert.match(fn, /prepareProgramForNewQuote\(pg\)/)
  assert.match(fn, /initialQuote: null, \/\/ a brand-new quote/)
  assert.match(fn, /saveAsNewRow\(\{ payload, original, clientId: client\.id, userId, now: new Date\(\) \}\)/)
  assert.match(fn, /supabase\.from\('quotes'\)\.insert\(row\)\.select\(\)\.single\(\)/)
  assert.doesNotMatch(fn, /\.update\(/) // the original row is never written
  assert.match(fn, /quoteRef\.current = saved\s+ownRowRef\.current = saved\.id/)
  assert.match(fn, /Saved as new quote #\$\{escHtml\(saved\.quote_number \|\| ''\)\} — \$\{escHtml\(origNo\)\} is unchanged/)
  // a later Update (main button / program's SAVE QUOTE) of the new row updates THAT row, never the one the lead page opened
  assert.match(src, /if \(cur\?\.id && ownRowRef\.current === cur\.id\) return updateQuoteRow\(supabase, cur, payload\)/)
  // a NEW quote keeps the single Save to Lead button
  assert.match(src, /\{hasQuote \? \(\s*<SaveSplitButton/)
  assert.match(src, /'💾 Save to Lead'\}<\/button>\s*\)\}/)
})
