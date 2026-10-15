// Unit tests for the lead's Building size/type filled in from its quote on file
// (src/lib/leadQuoteSpec.js). Run: npm test   (node --test, no dependencies)
//
// Owner 10/15/26: "if i am on the leads page & I click on working leads - some
// of the working leads dont have building info & they should they should be
// able to pull that info directly from the quote saved on file".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildingTypeFromQuote, quoteBuildingType, specFromQuotes, specsByClient, leadBuildingSpec, fromQuoteTitle,
  loadQuoteSpecs, SPEC_PAGE,
} from '../src/lib/leadQuoteSpec.js'
import { BUILDING_TYPES } from '../src/lib/constants.js'

// A builder quote as the light select returns it (pt/agx = payload_json.fields.pt/.agx).
const q = (o) => ({ client_id: 'L1', status: 'sent', deleted_at: null, quote_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', ...o })

test('Property Type maps to the lead building types', () => {
  assert.equal(buildingTypeFromQuote('res'), 'residential')
  assert.equal(buildingTypeFromQuote('rc2r'), 'risk_cat_2_residential')
  assert.equal(buildingTypeFromQuote('com'), 'commercial')
  assert.equal(buildingTypeFromQuote('ag', 'no'), 'agricultural')
  assert.equal(buildingTypeFromQuote('ag', ''), 'agricultural')
  assert.equal(buildingTypeFromQuote('ag', null), 'agricultural')
  assert.equal(buildingTypeFromQuote('ag', 'yes'), 'ag_exempt')
  // every value it can give is a real lead building type
  const values = BUILDING_TYPES.map((b) => b.value)
  for (const t of ['residential', 'risk_cat_2_residential', 'commercial', 'agricultural', 'ag_exempt']) assert.ok(values.includes(t), t)
})

test('no / unknown Property Type gives no type; Tax Exempt only counts for Agricultural', () => {
  assert.equal(buildingTypeFromQuote(''), null) // "— select —"
  assert.equal(buildingTypeFromQuote(null), null)
  assert.equal(buildingTypeFromQuote(undefined, 'yes'), null)
  assert.equal(buildingTypeFromQuote('standard'), null) // a structure type is not a building type
  assert.equal(buildingTypeFromQuote('res', 'yes'), 'residential')
})

test('type reads the light select (pt/agx) or a full row (payload_json.fields)', () => {
  assert.equal(quoteBuildingType({ pt: 'com' }), 'commercial')
  assert.equal(quoteBuildingType({ payload_json: { fields: { pt: 'ag', agx: 'yes' } } }), 'ag_exempt')
  // card.buildingType is the STRUCTURE (Standard / Wide Span / Carport) — never used
  assert.equal(quoteBuildingType({ payload_json: { card: { buildingType: 'Standard (12\'–30\' wide)' } } }), null)
  assert.equal(quoteBuildingType({ payload_json: null }), null) // hand-typed / uploaded quote
  assert.equal(quoteBuildingType(null), null)
})

test('the starred quote wins over a newer one', () => {
  const qs = [
    q({ id: 'old', quote_date: '2026-09-01', building_size: '20x30x10', pt: 'res', starred: true }),
    q({ id: 'new', quote_date: '2026-10-05', building_size: '30x40x12', pt: 'com', starred: false }),
  ]
  const s = specFromQuotes(qs)
  assert.equal(s.size, '20x30x10')
  assert.equal(s.type, 'residential')
  assert.equal(s.quote.id, 'old')
  // no star: the newest (quote_date, then created_at)
  const n = specFromQuotes(qs.map((x) => ({ ...x, starred: false })))
  assert.equal(n.size, '30x40x12')
  assert.equal(n.type, 'commercial')
  const tie = specFromQuotes([
    q({ id: 'a', created_at: '2026-10-01T09:00:00Z', building_size: '12x21x6' }),
    q({ id: 'b', created_at: '2026-10-01T15:00:00Z', building_size: '24x31x9' }),
  ])
  assert.equal(tie.size, '24x31x9')
})

test('deleted and superseded quotes are skipped, even when starred or newest', () => {
  const s = specFromQuotes([
    q({ id: 'del', quote_date: '2026-10-09', building_size: '40x60x14', pt: 'com', deleted_at: '2026-10-10T00:00:00Z' }),
    q({ id: 'sup', quote_date: '2026-10-08', building_size: '30x50x14', pt: 'ag', status: 'superseded', starred: true }),
    q({ id: 'ok', quote_date: '2026-10-01', building_size: '24x30x10', pt: 'res' }),
  ])
  assert.equal(s.size, '24x30x10')
  assert.equal(s.type, 'residential')
  assert.equal(s.quote.id, 'ok')
  // only deleted / superseded quotes -> nothing
  const none = specFromQuotes([q({ building_size: '30x40x12', pt: 'res', deleted_at: 'x' }), q({ building_size: '30x40x12', pt: 'res', status: 'superseded' })])
  assert.equal(none.size, null)
  assert.equal(none.type, null)
})

test('declined / expired / draft quotes still count (the building on file is still that building)', () => {
  for (const status of ['declined', 'expired', 'draft', 'deposit_paid', 'revised']) {
    assert.equal(specFromQuotes([q({ status, building_size: '30x40x12', pt: 'res' })]).size, '30x40x12', status)
  }
})

test('size and type come only from the picked quote; an older quote never fills a blank', () => {
  // newest = an uploaded PDF with no size in its name and no type: both stay blank,
  // the older builder quote (maybe a building the client did not pick) is not shown
  const s = specFromQuotes([
    q({ id: 'pdf', quote_date: '2026-10-05', building_size: null, pt: null }),
    q({ id: 'build', quote_date: '2026-09-20', building_size: '24x30x10', pt: 'com' }),
  ])
  assert.equal(s.quote.id, 'pdf')
  assert.equal(s.size, null)
  assert.equal(s.type, null)
  // reviewer's case: newest = a hand-typed quote with the size left blank -> no size,
  // and never the size of one quote paired with the type of another
  const mixed = specFromQuotes([
    q({ id: 'typed', quote_date: '2026-10-10', building_size: '  ', pt: 'com' }),
    q({ id: 'sized', quote_date: '2026-09-01', building_size: '20x25x9', pt: 'res' }),
  ])
  assert.equal(mixed.quote.id, 'typed')
  assert.equal(mixed.type, 'commercial')
  assert.equal(mixed.size, null)
  // the starred builder quote with Property Type left on "— select —": its size,
  // no type — not the type of an older quote (maybe a different use)
  const blankPt = specFromQuotes([
    q({ id: 'star', quote_date: '2026-09-01', building_size: '18x21x7', pt: '', starred: true }),
    q({ id: 'newer', quote_date: '2026-10-01', building_size: '40x60x14', pt: 'com' }),
    q({ id: 'older', quote_date: '2026-08-01', building_size: '12x21x6', pt: 'res' }),
  ])
  assert.equal(blankPt.quote.id, 'star')
  assert.equal(blankPt.size, '18x21x7')
  assert.equal(blankPt.type, null)
  // a lead with no size or type of its own shows exactly that quote's values
  const shown = leadBuildingSpec({ building_size: null, building_type: null }, blankPt)
  assert.deepEqual([shown.size, shown.type, shown.sizeFrom?.id, shown.typeFrom], ['18x21x7', null, 'star', null])
})

test('no quotes -> nothing', () => {
  assert.deepEqual(specFromQuotes([]), { quote: null, size: null, type: null })
  assert.deepEqual(specFromQuotes(null), { quote: null, size: null, type: null })
  assert.equal(specsByClient([]).size, 0)
})

test('grouped per lead; leads whose quotes give nothing are left out', () => {
  const m = specsByClient([
    q({ client_id: 'A', building_size: '30x40x12', pt: 'res' }),
    q({ client_id: 'B', building_size: null, pt: '' }),
    q({ client_id: 'A', quote_date: '2026-08-01', building_size: '10x10x6', pt: 'com' }),
    q({ client_id: 'C', pt: 'rc2r' }),
    q({ client_id: null, building_size: '1x1x1' }),
  ])
  assert.deepEqual([...m.keys()].sort(), ['A', 'C'])
  assert.equal(m.get('A').size, '30x40x12')
  assert.equal(m.get('A').type, 'residential')
  assert.equal(m.get('C').type, 'risk_cat_2_residential')
  assert.equal(m.get('C').size, null)
})

test("the lead's own values win; the quote only fills blanks, size and type independently", () => {
  const spec = specFromQuotes([q({ quote_number: 'SS-2026-12345', building_size: '30x40x12', pt: 'com' })])
  // both typed on the lead: the quote changes nothing
  const own = leadBuildingSpec({ building_size: '24x30', building_type: 'residential' }, spec)
  assert.deepEqual(own, { size: '24x30', type: 'residential', sizeFrom: null, typeFrom: null })
  // own size, no type: type from the quote
  const half = leadBuildingSpec({ building_size: '24x30', building_type: null }, spec)
  assert.equal(half.size, '24x30')
  assert.equal(half.sizeFrom, null)
  assert.equal(half.type, 'commercial')
  assert.equal(half.typeFrom.quote_number, 'SS-2026-12345')
  // own type, no size: size from the quote
  const other = leadBuildingSpec({ building_size: '', building_type: 'agricultural' }, spec)
  assert.equal(other.size, '30x40x12')
  assert.equal(other.sizeFrom.quote_number, 'SS-2026-12345')
  assert.equal(other.type, 'agricultural')
  assert.equal(other.typeFrom, null)
  // nothing on the lead: both from the quote
  const blank = leadBuildingSpec({ building_size: null, building_type: null }, spec)
  assert.equal(blank.size, '30x40x12')
  assert.equal(blank.type, 'commercial')
  // a whitespace-only value on the lead counts as blank
  assert.equal(leadBuildingSpec({ building_size: '   ' }, spec).size, '30x40x12')
  // no quote spec: exactly the lead's own values, as before
  assert.deepEqual(leadBuildingSpec({ building_size: '12x21x6', building_type: null }, undefined), { size: '12x21x6', type: null, sizeFrom: null, typeFrom: null })
  assert.deepEqual(leadBuildingSpec({}, null), { size: null, type: null, sizeFrom: null, typeFrom: null })
})

test('hover hint names the quote', () => {
  assert.equal(fromQuoteTitle({ quote_number: 'SS-2026-12345' }), 'From quote #SS-2026-12345')
  assert.equal(fromQuoteTitle({ quote_number: null }), 'From the quote on file')
  assert.equal(fromQuoteTitle(null), undefined) // the lead's own value: no title attribute
})

// Fake Supabase client: select / eq / neq / order / range / then. Simulates a
// missing quotes.starred column (migration 019 not run) and a server that rejects
// the payload_json JSON-path select, and records every request.
function fakeSb(rows, { noStar = false, noJsonPath = false, fail = false, cap = Infinity } = {}) {
  const calls = []
  return { calls, from: (table) => {
    const call = { table, cols: '', eq: [], neq: [], range: null }
    calls.push(call)
    const qb = {
      select(c, o) { call.cols = c; call.count = o?.count; return qb }, eq(k, v) { call.eq.push([k, v]); return qb }, neq(k, v) { call.neq.push([k, v]); return qb },
      order() { return qb }, range(a, b) { call.range = [a, b]; return qb },
      then(res, rej) {
        if (fail) return Promise.resolve({ data: null, error: { message: 'network down' } }).then(res, rej)
        if (noStar && /\bstarred\b/.test(call.cols)) return Promise.resolve({ data: null, error: { message: 'column quotes.starred does not exist' } }).then(res, rej)
        if (noJsonPath && call.cols.includes('->')) return Promise.resolve({ data: null, error: { message: 'failed to parse select parameter' } }).then(res, rej)
        let out = rows.filter((r) => call.eq.every(([k, v]) => r[k] === v) && call.neq.every(([k, v]) => r[k] !== v))
        out = out.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
        const count = call.count === 'exact' ? out.length : null
        if (call.range) out = out.slice(call.range[0], Math.min(call.range[1] + 1, call.range[0] + cap))
        // the light select only returns the columns it asked for (pt/agx come from payload_json.fields)
        const keep = (r) => {
          const o = {}
          for (const part of call.cols.split(',').map((s) => s.trim())) {
            const m = /^(\w+):payload_json->fields->>(\w+)$/.exec(part)
            if (m) o[m[1]] = r.payload_json?.fields?.[m[2]] ?? null
            else o[part] = r[part]
          }
          return o
        }
        return Promise.resolve({ data: out.map(keep), error: null, count }).then(res, rej)
      },
    }
    return qb
  } }
}
const row = (o) => ({ status: 'sent', deleted_at: null, quote_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', starred: false, payload_json: null, ...o })

test('loader: one light query, never the whole payload_json; the star counts when the column exists', async () => {
  const rows = [
    row({ id: '1', client_id: 'A', quote_number: 'OLD', quote_date: '2026-09-01', building_size: '20x30x10', starred: true, payload_json: { fields: { pt: 'res' }, rendering_thumb: 'data:image/jpeg;base64,…' } }),
    row({ id: '2', client_id: 'A', quote_number: 'NEW', quote_date: '2026-10-05', building_size: '30x40x12', payload_json: { fields: { pt: 'com' } } }),
    row({ id: '3', client_id: 'B', quote_number: 'B1', building_size: '24x30x9', payload_json: { fields: { pt: 'ag', agx: 'yes' } } }),
  ]
  const sb = fakeSb(rows)
  const m = await loadQuoteSpecs(sb)
  assert.equal(sb.calls.length, 1)
  assert.equal(sb.calls[0].table, 'quotes')
  assert.ok(!/payload_json(?!->)/.test(sb.calls[0].cols), 'selects only payload_json->fields paths: ' + sb.calls[0].cols)
  assert.deepEqual(sb.calls[0].neq, [['status', 'superseded']])
  assert.equal(m.get('A').size, '20x30x10') // starred, though older
  assert.equal(m.get('A').type, 'residential')
  assert.equal(m.get('A').quote.quote_number, 'OLD')
  assert.equal(m.get('B').type, 'ag_exempt')
})

test('loader: no starred column -> newest wins; no JSON paths -> size only; unreadable -> null', async () => {
  const rows = [
    row({ id: '1', client_id: 'A', quote_date: '2026-09-01', building_size: '20x30x10', starred: true, payload_json: { fields: { pt: 'res' } } }),
    row({ id: '2', client_id: 'A', quote_date: '2026-10-05', building_size: '30x40x12', payload_json: { fields: { pt: 'com' } } }),
  ]
  const noStar = fakeSb(rows, { noStar: true })
  const a = await loadQuoteSpecs(noStar)
  assert.equal(noStar.calls.length, 2)
  assert.equal(a.get('A').size, '30x40x12')
  assert.equal(a.get('A').type, 'commercial')

  const noPath = fakeSb(rows, { noStar: true, noJsonPath: true })
  const b = await loadQuoteSpecs(noPath)
  assert.equal(noPath.calls.length, 4)
  assert.equal(b.get('A').size, '30x40x12')
  assert.equal(b.get('A').type, null)

  // JSON paths rejected but the star exists: size only, still the STARRED quote
  // (the lead page's Current Quote), never the newest
  const pathOnly = fakeSb(rows, { noJsonPath: true })
  const c = await loadQuoteSpecs(pathOnly)
  assert.equal(pathOnly.calls.length, 3)
  assert.ok(/\bstarred\b/.test(pathOnly.calls[2].cols) && !pathOnly.calls[2].cols.includes('->'))
  assert.equal(c.get('A').size, '20x30x10')
  assert.equal(c.get('A').type, null)

  // a failure that is not a missing column (network, timeout) is null at once —
  // never a poorer column set that would drop the star or the types
  const down = fakeSb(rows, { fail: true })
  assert.equal(await loadQuoteSpecs(down), null)
  assert.equal(down.calls.length, 1)
  // a client that throws never escapes either
  assert.equal(await loadQuoteSpecs({ from() { throw new Error('boom') } }), null)
})

test('loader: one lead only, and every page is read past the API row cap', async () => {
  const rows = [
    row({ id: '1', client_id: 'A', building_size: '30x40x12' }),
    row({ id: '2', client_id: 'B', building_size: '12x21x6' }),
  ]
  const one = fakeSb(rows)
  const m = await loadQuoteSpecs(one, 'A')
  assert.deepEqual(one.calls[0].eq, [['client_id', 'A']])
  assert.deepEqual([...m.keys()], ['A'])

  // more quotes than one page: the lead whose only quote sorts last is still found
  const many = []
  for (let i = 0; i < SPEC_PAGE + 5; i++) many.push(row({ id: String(i).padStart(5, '0'), client_id: 'X', building_size: '10x10x6' }))
  many.push(row({ id: '99999', client_id: 'LAST', building_size: '40x60x14' }))
  const paged = fakeSb(many)
  const all = await loadQuoteSpecs(paged)
  assert.equal(paged.calls.length, 2)
  assert.deepEqual(paged.calls.map((c) => c.range), [[0, SPEC_PAGE - 1], [SPEC_PAGE, 2 * SPEC_PAGE - 1]])
  assert.equal(all.get('LAST').size, '40x60x14')

  // a project whose API cap is below SPEC_PAGE: the row count keeps it paging
  const capped = fakeSb(many, { cap: 400 })
  const all2 = await loadQuoteSpecs(capped)
  assert.equal(capped.calls.length, 3)
  assert.deepEqual(capped.calls.map((c) => c.range[0]), [0, 400, 800])
  assert.equal(all2.get('LAST').size, '40x60x14')
})
