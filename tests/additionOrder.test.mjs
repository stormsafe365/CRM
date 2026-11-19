// Addition orders (owner 11/19/26, after Robert Andrews' door-only order for his installed CCI building: "is there a way
// to make one of these for people moving forward through our crm ?"). src/lib/additionOrder.js + additionHtml.js +
// the addition parts of contractDocs.js. Prices are checked against the quote program in public/build. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  ADDITION_FEE, IMPACT_CO, IMPACT_WIN_CO, additionCatalog, additionDefaults, additionFileName, additionRecord, additionsOf, addsInWords,
  buildingSizeOf, impactRuleFor, itemLine, newItem, nextAdditionNumber, patchAddition, priceAddition, saveAdditionPayload, withAddition,
} from '../src/lib/additionOrder.js'
import { buildAdditionHtml } from '../src/lib/additionHtml.js'
import * as parts from '../src/lib/contractParts.generated.js'
import { CRM_PAYLOAD_KEYS, carryCrmMarkers, organizeContracts, parseContractLabel, withLiveExecuted } from '../src/lib/contractDocs.js'

const here = dirname(fileURLToPath(import.meta.url))
const PROGRAM = readFileSync(resolve(here, '../public/build/quote-builder.html'), 'utf8')

// the program's MANUFACTURERS table, as the CRM's hidden price engine sees it
function programManufacturers() {
  const L = PROGRAM.split(/\r?\n/)
  const a = L.findIndex((l) => /^var MANUFACTURERS = \{/.test(l))
  const b = L.findIndex((l, i) => i > a && /^var ACTIVE_MFR = /.test(l))
  assert.ok(a > 0 && b > a, 'MANUFACTURERS found in the program')
  const ctx = {}
  vm.runInNewContext(L.slice(a, b).join('\n'), ctx)
  return JSON.parse(JSON.stringify(ctx.MANUFACTURERS)) // plain objects of this realm (the tables only)
}
const MF = programManufacturers()
const COUNTY_TAX = (() => { const m = /var COUNTY_TAX=(\{[^;]*\});/.exec(PROGRAM); assert.ok(m); return JSON.parse(m[1]) })()

// Robert Andrews' signed CCI order (the fields his contract printed)
const robert = {
  id: 'q-robert', client_id: 'c1', quote_number: 'SS-2026-79957', manufacturer: 'cci', status: 'deposit_paid', building_size: '24x20x12',
  payload_json: {
    mfr: 'CCI',
    fields: { cn: 'Robert Andrews', cp: '561-371-6119', ce: 'kokomobob2485@gmail.com', county: 'Palm Beach', tax: '6.5', bw: '24', bl: '20', bh: '12', 'ct-billaddr': '2485 Country Oaks Lane\nWest Palm Beach, FL 33410', 'ct-pay': 'Credit Card' },
    executed: { at: '2026-06-26', signedOn: '2026-06-26', confirmed: true },
  },
}

test('the impact county lists are the quote program\'s (rc() and PriceLock)', () => {
  const list = (re) => { const m = re.exec(PROGRAM); assert.ok(m, String(re)); return JSON.parse('[' + m[1].replace(/'/g, '"') + ']') }
  assert.deepEqual(IMPACT_CO, list(/var IMPACT_CO = \[([^\]]*)\]/))
  assert.deepEqual(IMPACT_WIN_CO, list(/var IMPACT_WIN_CO = \[([^\]]*)\]/))
  assert.deepEqual(IMPACT_CO, list(/var _pImpCo=\[([^\]]*)\]/))
  assert.deepEqual(IMPACT_WIN_CO, list(/var _pImpWinCo=\[([^\]]*)\]/))
  assert.match(PROGRAM, /_pImpDoor=_pCci && \(_pImpCo\.indexOf\(_pCo\)>=0 \|\| \(\(_pCo==='Okaloosa'\|\|_pCo==='Okeechobee'\) && _pSqft>720\)\)/)
  assert.match(PROGRAM, /var _pWinOK=\{hi:1,hi3036:1\};/)
})

test('county rule: CCI Palm Beach = Hi-Wind doors + Hi-Impact windows; Orange = windows only; Okeechobee over 720 sq ft; CA none', () => {
  assert.deepEqual(impactRuleFor('CCI', 'Palm Beach', 480), { doors: true, windows: true })
  assert.deepEqual(impactRuleFor('CCI', 'Orange', 480), { doors: false, windows: true })
  assert.deepEqual(impactRuleFor('CCI', 'Okeechobee', 720), { doors: false, windows: false })
  assert.deepEqual(impactRuleFor('CCI', 'Okeechobee', 721), { doors: true, windows: true })
  assert.deepEqual(impactRuleFor('CCI', 'Broward', 480), { doors: false, windows: false })
  assert.deepEqual(impactRuleFor('CA', 'Palm Beach', 480), { doors: false, windows: false })
})

test('the catalog is the program\'s doors and windows at its prices; locked models in an impact county', () => {
  const cat = additionCatalog(MF.CCI, impactRuleFor('CCI', 'Palm Beach', 480))
  const hw = cat.wtd.find((t) => t.v === 'hiwind')
  assert.equal(hw.price, MF.CCI.wtdPrices.hiwind)
  assert.equal(hw.price, 600)
  assert.equal(hw.label, 'Man Door (Hi-Wind Rated) 36\xD780')
  assert.equal(hw.locked, false)
  assert.ok(cat.wtd.filter((t) => t.v !== 'hiwind').every((t) => t.locked))
  assert.deepEqual(cat.win.filter((t) => !t.locked).map((t) => t.v), ['hi', 'hi3036'])
  assert.equal(cat.wtd.length, MF.CCI.wtdTypes.length)
  assert.equal(cat.win.length, MF.CCI.winTypes.length)
  // a new row starts on the allowed door / window
  assert.equal(newItem(cat, 'wtd').type, 'hiwind')
  assert.equal(newItem(cat, 'win').type, 'hi')
  // CA: its own table, nothing locked
  const ca = additionCatalog(MF.CA, impactRuleFor('CA', 'Palm Beach', 480))
  assert.deepEqual(ca.wtd.map((t) => [t.v, t.price, t.locked]), MF.CA.wtdTypes.map((t) => [t.v, MF.CA.wtdPrices[t.v], false]))
  assert.deepEqual(ca.win.map((t) => [t.v, t.price]), MF.CA.winTypes.map((t) => [t.v, MF.CA.winPrices[t.v]]))
})

test('Robert Andrews: $600 door + $39 tax + $200 CCI addition fee = $839; deposit 17% = $102, or waived', () => {
  const d = additionDefaults(robert, {}, { countyTax: COUNTY_TAX })
  assert.equal(d.mfr, 'CCI')
  assert.equal(d.taxPct, 6.5)
  assert.equal(d.fee, 200)
  assert.equal(d.root, 'SS-2026-79957')
  assert.equal(d.origSigned, '2026-06-26')
  assert.equal(d.building, '24′ \xD7 20′ \xD7 12′')
  assert.equal(d.siteAddr, d.billAddr)
  assert.equal(d.payMethod, 'Credit Card')
  const cat = additionCatalog(MF.CCI, impactRuleFor(d.mfr, d.county, d.sqft))
  const items = [{ ...newItem(cat, 'wtd'), wall: 'Back gable end', framed: true }]
  const m = priceAddition({ items, catalog: cat, taxPct: d.taxPct, fee: d.fee })
  assert.deepEqual([m.sub, m.tax, m.fee, m.total, m.deposit, m.balance, m.ok], [600, 39, 200, 839, 102, 737, true])
  assert.equal(m.lines[0].desc, 'Man Door (Hi-Wind Rated) 36\xD780 — Back gable end, into the existing framed opening')
  const w = priceAddition({ items, catalog: cat, taxPct: d.taxPct, fee: d.fee, waived: true })
  assert.deepEqual([w.total, w.deposit, w.balance, w.waived], [839, 0, 839, true])
  assert.equal(addsInWords(m.lines), 'one walk-in door')
})

test('tax and deposit are whole dollars like the program (qMoney); a locked or unpriced item cannot go out', () => {
  const cat = additionCatalog(MF.CCI, impactRuleFor('CCI', 'Broward', 480))
  const items = [{ kind: 'win', type: 'hw', qty: 1 }] // $675
  const m = priceAddition({ items, catalog: cat, taxPct: 6.5, fee: 200 })
  assert.equal(m.tax, Math.round(675 * 0.065)) // 43.875 -> 44
  assert.equal(m.deposit, Math.round(675 * 0.17)) // 114.75 -> 115
  const pb = additionCatalog(MF.CCI, impactRuleFor('CCI', 'Palm Beach', 480))
  const bad = priceAddition({ items: [{ kind: 'wtd', type: 'std', qty: 1 }], catalog: pb, taxPct: 6.5, fee: 200 })
  assert.equal(bad.ok, false)
  assert.match(bad.why, /High-Wind/)
  assert.equal(priceAddition({ items: [], catalog: pb }).ok, false)
  const other = itemLine({ kind: 'other', desc: '', price: 50, qty: 1 }, pb)
  assert.equal(other.ok, false)
  const other2 = itemLine({ kind: 'other', desc: 'Extra J-trim', price: '45.5', qty: 2, wall: 'Left side' }, pb)
  assert.deepEqual([other2.ok, other2.amount, other2.desc], [true, 91, 'Extra J-trim — Left side'])
  assert.equal(addsInWords([{ kind: 'wtd', qty: 2 }, { kind: 'win', qty: 1 }, { kind: 'other', qty: 1 }]), 'two walk-in doors, one window and one other item')
})

test('CA: no fee filled in (not confirmed - the rep types it); the lead\'s own details when the quote has none', () => {
  const q = { id: 'x', quote_number: 'SS-2026-11111', manufacturer: 'ca', building_size: '30x40x12', payload_json: null }
  const client = { first_name: 'Ann', last_name: 'Lee', phone: '555', email: 'a@b.c', address_line: '1 Main St', city: 'Stuart', state: 'FL', zip: '34994', county: 'Martin' }
  const d = additionDefaults(q, client, { countyTax: COUNTY_TAX })
  assert.equal(d.mfr, 'CA')
  assert.equal(d.fee, null)
  assert.equal(d.feeNote, ADDITION_FEE.CA.note)
  assert.equal(d.name, 'Ann Lee')
  assert.equal(d.billAddr, '1 Main St\nStuart, FL 34994')
  assert.equal(d.county, 'Martin')
  assert.equal(d.taxPct, COUNTY_TAX.Martin)
  assert.equal(d.building, '30′ \xD7 40′ \xD7 12′')
  assert.equal(d.root, 'SS-2026-11111')
  // an agricultural-exempt original: no tax
  assert.equal(additionDefaults({ ...robert, payload_json: { ...robert.payload_json, fields: { ...robert.payload_json.fields, agx: 'yes' } } }, {}, { countyTax: COUNTY_TAX }).taxPct, 0)
  assert.equal(buildingSizeOf({ building_size: '' }), '')
  // no manufacturer on a hand-added quote: the lead's, else CCI
  assert.equal(additionDefaults({ quote_number: 'SS-2026-22222', payload_json: null }, { building_mfr: 'ca' }).mfr, 'CA')
  assert.equal(additionDefaults({ quote_number: 'SS-2026-22222', manufacturer: 'cci' }, { building_mfr: 'ca' }).mfr, 'CCI')
  assert.equal(additionDefaults({ quote_number: 'SS-2026-22222' }, {}).mfr, 'CCI')
})

test('numbering: the agreement number + A, B...; letters already used on the lead (saved or a file) are skipped', () => {
  assert.deepEqual(nextAdditionNumber('SS-2026-79957', [robert], []), { letter: 'A', number: 'SS-2026-79957-A' })
  const withA = { ...robert, payload_json: { ...robert.payload_json, additions: [{ number: 'SS-2026-79957-A', createdAt: '2026-11-19T15:00:00Z' }] } }
  assert.equal(nextAdditionNumber('SS-2026-79957', [withA], []).number, 'SS-2026-79957-B')
  assert.equal(nextAdditionNumber('SS-2026-79957', [robert], ['Robert_Andrews-StormSafe_Steel_ADDITION_ORDER_SS-2026-79957-A__11.19_.pdf']).number, 'SS-2026-79957-B')
  // another agreement's letters do not count; a deleted quote's do not either
  assert.equal(nextAdditionNumber('SS-2026-79957', [{ ...withA, deleted_at: '2026-11-19' }], ['SS-2026-11111-A.pdf']).number, 'SS-2026-79957-A')
  // the signed paper's number wins over the quote's own
  const peter = { quote_number: 'SS-2026-68012', payload_json: { executed: { at: '2026-09-24', number: 'SS-2026-02861' } } }
  assert.equal(additionDefaults(peter, {}).root, 'SS-2026-02861')
})

test('the record on the quote: added, replaced by number, signed later; kept on a re-save, never copied', async () => {
  const d = additionDefaults(robert, {}, { countyTax: COUNTY_TAX })
  const cat = additionCatalog(MF.CCI, impactRuleFor(d.mfr, d.county, d.sqft))
  const items = [{ ...newItem(cat, 'wtd'), wall: 'Back gable end', framed: true }]
  const money = priceAddition({ items, catalog: cat, taxPct: d.taxPct, fee: d.fee, waived: true })
  const rec = additionRecord({ number: 'SS-2026-79957-A', date: '2026-11-19', d, money, items, payMethod: 'Credit Card', filePath: 'c1/contract/1-x.pdf', by: 'u1', now: new Date('2026-11-19T15:00:00Z') })
  assert.equal(rec.total, 839)
  assert.equal(rec.payMethod, '') // waived: no deposit method
  assert.deepEqual(rec.items[0], { kind: 'wtd', type: 'hiwind', qty: 1, wall: 'Back gable end', framed: true, desc: money.lines[0].desc, unit: 600, amount: 600 })
  let p = withAddition(robert.payload_json, rec)
  assert.equal(p.additions.length, 1)
  assert.equal(p.executed, robert.payload_json.executed) // the building's mark is untouched
  p = withAddition(p, { ...rec, total: 1 })
  assert.equal(p.additions.length, 1)
  p = patchAddition(p, 'SS-2026-79957-A', { signed: { on: '2026-11-20', filePath: 'c1/contract/2-s.pdf' } })
  assert.equal(p.additions[0].signed.on, '2026-11-20')
  assert.equal(patchAddition(p, 'SS-2026-79957-Z', {}), null)
  assert.equal(withAddition(null, rec).additions.length, 1) // a hand-added quote with no payload
  // a builder re-save keeps them; Save as a new quote / a duplicate never copies them (ORIGINAL_ONLY = CRM_PAYLOAD_KEYS + ...)
  assert.ok(CRM_PAYLOAD_KEYS.includes('additions'))
  assert.deepEqual(carryCrmMarkers(p, { fields: {} }).additions, p.additions)
  // a builder save over a stale copy: the row's live additions win
  const sb = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { payload_json: p }, error: null }) }) }) }) }
  assert.deepEqual((await withLiveExecuted(sb, 'q-robert', { fields: {}, additions: [] })).additions, p.additions)
  assert.equal(additionsOf([{ ...robert, payload_json: p }]).length, 1)
})

test('saveAdditionPayload reads the row fresh, then writes', async () => {
  const writes = []
  const live = { fields: { cn: 'X' }, executed: { at: '2026-06-26' } }
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { payload_json: live }, error: null }) }) }),
      update: (v) => ({ eq: async () => { writes.push(v); return { error: null } } }),
    }),
  }
  const out = await saveAdditionPayload(sb, 'q', (pl) => withAddition(pl, { number: 'SS-2026-79957-A' }))
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].payload_json, out)
  assert.equal(out.executed, live.executed)
  await assert.rejects(saveAdditionPayload(sb, 'q', () => null), /not on this quote/)
})

test('file names: an addition order is its own contract number, never the building\'s', () => {
  const name = additionFileName('Robert Andrews', 'SS-2026-79957-A', '2026-11-19')
  assert.equal(name, 'Robert Andrews-StormSafe Steel ADDITION ORDER SS-2026-79957-A (11.19).pdf')
  const stored = name.replace(/[^a-zA-Z0-9.-]/g, '_') // lib/storage sanitizes
  assert.deepEqual(parseContractLabel(stored), { base: 'SS-2026-79957-A', rev: null, number: 'SS-2026-79957-A', add: 'A', of: 'SS-2026-79957' })
  assert.equal(parseContractLabel('SS-2026-79957-A signed.pdf').number, 'SS-2026-79957-A')
  assert.equal(parseContractLabel('SS-2026-79957-B.pdf').number, 'SS-2026-79957-B')
  // the building's own contracts read as before
  assert.deepEqual(parseContractLabel('SS-2026-00144-contract.pdf'), { base: 'SS-2026-00144', rev: null, number: 'SS-2026-00144' })
  assert.deepEqual(parseContractLabel('SS-2026-00144-Rev-1-contract.pdf'), { base: 'SS-2026-00144', rev: '1', number: 'SS-2026-00144 Rev 1' })
  assert.equal(parseContractLabel('SS-2026-00144-Agreement.pdf').number, 'SS-2026-00144')
  assert.equal(parseContractLabel('SS-2026-00144-executed-deposit-paid.pdf').number, 'SS-2026-00144')
})

test('Documents › Contracts: the addition order sits in its own list, not under the building\'s signed card', () => {
  const F = (label, at) => ({ label, path: `c1/contract/${Date.parse(at)}-${label}`, createdAt: at })
  const signedCopy = F('Robert_Andrews_signed.pdf', '2026-06-27T12:00:00Z')
  const addFile = F('Robert_Andrews-StormSafe_Steel_ADDITION_ORDER_SS-2026-79957-A__11.19_.pdf', '2026-11-19T15:00:00Z')
  const addCopy = F('Robert_Andrews-StormSafe_Steel_ADDITION_ORDER_SS-2026-79957-A__11.20_.pdf', '2026-11-20T15:00:00Z')
  const addSigned = F('scan_from_customer.pdf', '2026-11-21T15:00:00Z')
  const contractCopy = F('SS-2026-79957-contract.pdf', '2026-06-26T12:00:00Z')
  const q = { ...robert, payload_json: { ...robert.payload_json, executed: { ...robert.payload_json.executed, filePath: signedCopy.path },
    additions: [{ number: 'SS-2026-79957-A', date: '2026-11-19', total: 839, filePath: addFile.path, signed: { on: '2026-11-21', filePath: addSigned.path }, createdAt: '2026-11-19T15:00:00Z' }] } }
  const out = organizeContracts([signedCopy, addFile, addCopy, addSigned, contractCopy], [q])
  assert.equal(out.signed.length, 1)
  assert.equal(out.signed[0].signedFile.path, signedCopy.path)
  assert.deepEqual(out.signed[0].generated.map((f) => f.path), [contractCopy.path])
  assert.equal(out.additions.length, 1)
  const a = out.additions[0]
  assert.equal(a.number, 'SS-2026-79957-A')
  assert.equal(a.file.path, addFile.path)
  assert.equal(a.signedFile.path, addSigned.path)
  assert.deepEqual(a.others.map((f) => f.path), [addCopy.path])
  assert.equal(out.uploads.length, 0)
  assert.equal(out.unsigned.length, 0)
  // a lead with no additions: the list is empty and nothing else moves
  assert.deepEqual(organizeContracts([contractCopy], [robert]).additions, [])
})

test('the document: page 1 order + page 2 terms - CCI\'s for CCI, StormSafe\'s for CA; typed text is escaped', () => {
  const d = additionDefaults(robert, {}, { countyTax: COUNTY_TAX })
  const cat = additionCatalog(MF.CCI, impactRuleFor(d.mfr, d.county, d.sqft))
  const items = [{ ...newItem(cat, 'wtd'), wall: 'Back gable end', framed: true }]
  const money = priceAddition({ items, catalog: cat, taxPct: d.taxPct, fee: d.fee, waived: true })
  const html = buildAdditionHtml(parts, { number: 'SS-2026-79957-A', date: '2026-11-19', d, money, items, payMethod: 'Credit Card', notes: 'No window <b>please</b>', addsInWords: addsInWords(money.lines) })
  assert.match(html, /Purchase Agreement &mdash; Addition/)
  assert.match(html, /SS-2026-79957-A/)
  assert.match(html, /Date: <strong>November 19, 2026<\/strong>/)
  assert.match(html, /signed June 26, 2026; 24′ \xD7 20′ \xD7 12′/)
  assert.match(html, /existing 36″ \xD7 80″ walk-through framed opening on the back gable end/)
  assert.match(html, /\$839\.00/)
  assert.match(html, /WAIVED/)
  assert.doesNotMatch(html, /Payment Method \(deposit\)/)
  assert.match(html, /Addition Delivery Fee \(not taxed\)/)
  assert.ok(html.includes(parts.CCI_TERMS))
  assert.ok(html.includes(parts.CCI_LOGO))
  assert.match(html, /PURCHASE OF SAID ADDITION FROM CAROLINA CARPORTS/)
  assert.match(html, /No window &lt;b&gt;please&lt;\/b&gt;/)
  assert.equal((html.match(/class="page"/g) || []).length, 2)
  // with a deposit: due now + the method
  const m2 = priceAddition({ items, catalog: cat, taxPct: d.taxPct, fee: d.fee })
  const h2 = buildAdditionHtml(parts, { number: 'SS-2026-79957-A', date: '2026-11-19', d, money: m2, items, payMethod: 'Check', addsInWords: 'one walk-in door' })
  assert.match(h2, /Deposit Due Now \(17%\)<\/span><span class="v">\$102\.00/)
  assert.match(h2, /Payment Method \(deposit\)<\/span><span class="v">Check/)
  assert.match(h2, /Balance at Scheduling<\/span><span class="v">\$737\.00/)
  // CA: StormSafe's own terms and header, no manufacturer named anywhere
  const qa = { ...robert, manufacturer: 'ca', payload_json: { ...robert.payload_json, mfr: 'CA' } }
  const da = additionDefaults(qa, {}, { countyTax: COUNTY_TAX })
  const ca = additionCatalog(MF.CA, impactRuleFor('CA', da.county, da.sqft))
  const ia = [newItem(ca, 'win')]
  const ma = priceAddition({ items: ia, catalog: ca, taxPct: da.taxPct, fee: 0 })
  const h3 = buildAdditionHtml(parts, { number: 'SS-2026-79957-A', date: '2026-11-19', d: da, money: ma, items: ia, payMethod: 'Check', addsInWords: addsInWords(ma.lines) })
  assert.ok(h3.includes(parts.SS_TERMS))
  assert.doesNotMatch(h3, /Carolina|CCI|Carports Anywhere/)
  assert.match(h3, /STORM<span>SAFE<\/span> STEEL/)
  assert.doesNotMatch(h3, /Addition (Delivery )?Fee/) // no fee typed
})

// ── review 11/19/26 ──────────────────────────────────────────────────────────────────────────────
import { stripForDuplicate } from '../src/lib/priceLockCrm.js'
import { canonCounty } from '../src/lib/additionOrder.js'

test('review: a Duplicate / "Make a revision" copy never carries the addition orders (builder and hand-added quotes)', () => {
  const withA = { ...robert.payload_json, additions: [{ number: 'SS-2026-79957-A' }] }
  assert.equal(stripForDuplicate(withA, { newNumber: 'SS-2026-00001' }).additions, undefined)
  const tab = readFileSync(resolve(here, '../src/components/QuotesTab.jsx'), 'utf8')
  assert.match(tab, /!builder && quote\.payload_json && typeof quote\.payload_json === 'object' && quote\.payload_json\.additions !== undefined\s*\n\s*\? \{ payload_json: \(\(\{ additions, \.\.\.p \}\) => p\)\(quote\.payload_json\) \}/)
  // and if an older copy already has one, Contracts still shows it once - the record whose file is there
  const F = (label, at) => ({ label, path: `c1/contract/${Date.parse(at)}-${label}`, createdAt: at })
  const addFile = F('X-StormSafe_Steel_ADDITION_ORDER_SS-2026-79957-A__11.19_.pdf', '2026-11-19T15:00:00Z')
  const rec = { number: 'SS-2026-79957-A', filePath: addFile.path, createdAt: '2026-11-19T15:00:00Z' }
  const copy = { id: 'copy', quote_number: 'SS-2026-00001', payload_json: { additions: [{ ...rec, filePath: 'gone' }] } }
  const orig = { ...robert, payload_json: { ...robert.payload_json, additions: [rec] } }
  const out = organizeContracts([addFile], [copy, orig])
  assert.equal(out.additions.length, 1)
  assert.equal(out.additions[0].quote.id, 'q-robert')
  assert.equal(out.additions[0].file.path, addFile.path)
})

test('review: numbering works on any typed quote number; a new addition never replaces a saved one', () => {
  const q = (nums) => [{ payload_json: { additions: nums.map((number) => ({ number })) } }]
  assert.equal(nextAdditionNumber('Andrews-1', q(['Andrews-1-A']), []).number, 'Andrews-1-B')
  assert.equal(nextAdditionNumber('ss-2026-79957', q(['ss-2026-79957-A']), []).number, 'ss-2026-79957-B')
  assert.equal(nextAdditionNumber('SS-2026-79957', q(['SS-2026-79957-A', 'SS-2026-79957-B']), ['SS-2026-79957-C.pdf']).number, 'SS-2026-79957-D')
  // a root that is a prefix of another number, and Rev / EXECUTED names, do not use letters
  assert.equal(nextAdditionNumber('SS-2026-7995', [], ['SS-2026-79957-A.pdf', 'SS-2026-7995-Rev-1.pdf', 'SS-2026-7995-EXECUTED-deposit-paid.pdf']).number, 'SS-2026-7995-A')
  assert.equal(nextAdditionNumber('', [], []), null)
  assert.throws(() => withAddition({ additions: [{ number: 'SS-2026-79957-A' }] }, { number: 'SS-2026-79957-A' }, { create: true }), /already on this quote/)
  assert.equal(withAddition({ additions: [{ number: 'SS-2026-79957-A' }] }, { number: 'SS-2026-79957-B' }, { create: true }).additions.length, 2)
})

test('review: a typed county ("palm beach county", "St Lucie") reads like the program - same lock and tax', () => {
  assert.equal(canonCounty('palm beach county', COUNTY_TAX), 'Palm Beach')
  assert.equal(canonCounty('Palm  Beach', COUNTY_TAX), 'Palm Beach')
  assert.equal(canonCounty('St Lucie', COUNTY_TAX), 'St. Lucie')
  assert.equal(canonCounty('saint lucie', COUNTY_TAX), 'St. Lucie')
  assert.equal(canonCounty('Miami Dade', COUNTY_TAX), 'Miami-Dade')
  assert.equal(canonCounty('palm beach', null), 'Palm Beach') // before the program's table loads: the impact lists
  assert.equal(canonCounty('Nowhere', COUNTY_TAX), 'Nowhere')
  const hand = { quote_number: 'SS-2026-33333', manufacturer: 'cci', payload_json: null }
  const d = additionDefaults(hand, { county: 'palm beach county' }, { countyTax: COUNTY_TAX })
  assert.equal(d.county, 'Palm Beach')
  assert.equal(d.taxPct, 6.5)
  assert.deepEqual(impactRuleFor(d.mfr, d.county, d.sqft), { doors: true, windows: true })
  assert.equal(additionDefaults(hand, { county: 'St Lucie' }, { countyTax: COUNTY_TAX }).county, 'St. Lucie')
})

test('review: Doc Hub - no ✓ on a file named for an addition with no record; a cancelled attach never lingers', () => {
  const hub = readFileSync(resolve(here, '../src/components/DocumentHub.jsx'), 'utf8')
  assert.match(hub, /const canMark = cat === 'contract' && !signedPaths\.has\(f\.path\) && !\(pa && pa\.add && !addE\)/)
  assert.match(hub, /function triggerUpload\(cat, attachTo = null, addTo = null\) \{\n\s*uploadCat\.current = cat\n\s*attachFor\.current = attachTo\n\s*attachAdd\.current = addTo/)
  assert.doesNotMatch(hub, /attachAdd\.current = e;/)
})
