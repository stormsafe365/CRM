// Unit tests for customer design links (src/lib/designLinks.js). Run: npm test
//
// Owner 10/16/26: send a lead a link to design their building in 3D (no prices);
// "Send to my steel building rep" lands it on the lead in the CRM.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newToken, designLinkUrl, designLinkMessage, isMissingTable, createDesignLink, matchLeads, safeImage, designSummary,
  escHtml, TOKEN_RE, DESIGN_SITE, loadClientDesigns, searchTerm, pickerList, attachDesign, sameSender,
  sharedLinkMessage, sharedLabelOk, sharedFrom, designImage,
} from '../src/lib/designLinks.js'

test('tokens: 24 URL-safe characters the database accepts, never repeating', () => {
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const t = newToken()
    assert.equal(t.length, 24)
    assert.ok(TOKEN_RE.test(t), t)
    assert.ok(/^[A-Za-z0-9_-]{20,64}$/.test(t)) // the check constraint in 020_design_links.sql
    seen.add(t)
  }
  assert.equal(seen.size, 500)
  // every byte value maps into the alphabet
  assert.equal(newToken(() => new Uint8Array(18).fill(255)), '________________________')
  assert.equal(newToken(() => new Uint8Array(18)), 'AAAAAAAAAAAAAAAAAAAAAAAA')
})

test('link + message: the page address, first names, no CRM wording', () => {
  assert.equal(designLinkUrl('abc'), `${DESIGN_SITE}?t=abc`)
  assert.ok(DESIGN_SITE.startsWith('https://'))
  const m = designLinkMessage({ clientName: 'Jack Daouly', repName: 'Jenna Shiebler', url: 'https://x/?t=1' })
  assert.match(m, /^Hi Jack, it's Jenna with StormSafe Steel\./)
  assert.match(m, /Send to my steel building rep/)
  assert.match(m, /https:\/\/x\/\?t=1$/)
  assert.doesNotMatch(m, /crm/i)
  assert.match(designLinkMessage({ clientName: '', repName: '', url: 'u' }), /^Hi, it's your rep at StormSafe Steel\./)
})

test('missing tables (migration 020 not run) are recognized', () => {
  assert.ok(isMissingTable({ code: '42P01', message: 'relation "design_links" does not exist' }))
  assert.ok(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.design_links' in the schema cache" }))
  assert.ok(!isMissingTable({ code: '23505', message: 'duplicate key' }))
  assert.ok(!isMissingTable(null))
})

test('createDesignLink inserts the token for the lead and returns the URL; friendly error before 020', async () => {
  const inserted = []
  const sb = { from: (t) => ({ insert: async (row) => { inserted.push({ t, row }); return { error: null } } }) }
  const l = await createDesignLink(sb, { clientId: 'C1', userId: 'U1' })
  assert.equal(inserted[0].t, 'design_links')
  assert.deepEqual(Object.keys(inserted[0].row).sort(), ['client_id', 'created_by', 'token'])
  assert.equal(inserted[0].row.client_id, 'C1')
  assert.equal(l.url, designLinkUrl(l.token))
  const sbMissing = { from: () => ({ insert: async () => ({ error: { code: '42P01', message: 'relation "design_links" does not exist' } }) }) }
  await assert.rejects(createDesignLink(sbMissing, {}), (e) => e.missingTable === true && /020_design_links/.test(e.message))
})

test('loadClientDesigns: rows, or missing before 020', async () => {
  const chain = (result) => {
    const c = { select: () => c, eq: () => c, neq: () => c, is: () => c, order: () => c, limit: async () => result }
    return { from: () => c }
  }
  assert.deepEqual(await loadClientDesigns(chain({ data: [{ id: 1 }], error: null }), 'C1'), { rows: [{ id: 1 }], missing: false })
  const r = await loadClientDesigns(chain({ data: null, error: { code: '42P01', message: 'relation "design_requests" does not exist' } }), 'C1')
  assert.equal(r.missing, true)
  assert.deepEqual(r.rows, [])
})

test('matchLeads: phone / email first, then name', () => {
  const leads = [
    { id: 'a', name: 'Jane Doe', phone: '', email: '' },
    { id: 'b', name: 'Someone', phone: '+1 (561) 555-0100', email: '' },
    { id: 'c', name: 'Other', phone: '', email: 'JANE@example.com' },
    { id: 'd', name: 'Nobody', phone: '9999999999', email: 'x@y.z' },
  ]
  assert.deepEqual(matchLeads({ name: 'jane doe', phone: '561-555-0100', email: 'jane@example.com' }, leads).map((c) => c.id), ['b', 'c', 'a'])
  assert.deepEqual(matchLeads({ name: 'Zed', phone: '', email: '' }, leads), [])
})

test('safeImage only lets a JPEG data URL into <img src>', () => {
  assert.equal(safeImage('data:image/jpeg;base64,QUJD'), 'data:image/jpeg;base64,QUJD')
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'https://evil/x.jpg', 'data:image/jpeg;base64,QU"onerror=1', null, 5]) {
    assert.equal(safeImage(bad), null, String(bad))
  }
})

test('designSummary: W × L × H from the saved design', () => {
  assert.equal(designSummary({ design: { type: 'garage', width: 24, length: 30, height: 10, leanTos: [{}] } }), "Garage 24' × 30' × 10' (W × L × H) + 1 lean-to")
  assert.equal(designSummary({ design: { type: 'combo', width: 20, length: 40, height: 12, leanTos: [] } }), "Garage + Carport 20' × 40' × 12' (W × L × H)")
  assert.equal(designSummary({ design: { type: 'x', width: 'a' } }), 'Building')
  assert.equal(designSummary(null), '')
})

test('escHtml keeps customer text out of the toast markup', () => {
  assert.equal(escHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(escHtml(`Tom & "Jerry's"`), 'Tom &amp; &quot;Jerry&#39;s&quot;')
})

test('searchTerm: only characters that are safe in a PostgREST or() filter', () => {
  assert.equal(searchTerm('  Jack (Daouly), "x"*  '), 'Jack Daouly x')
  assert.equal(searchTerm("o'brien@x.com"), "o'brien@x.com")
  assert.equal(searchTerm('a'.repeat(80)).length, 60)
})

test('pickerList: newest leads, or local + server matches, never Trash', () => {
  const base = [
    { id: '1', name: 'Jack Daouly', phone: '(239) 555-0100', email: '' },
    { id: '2', name: 'Pat', phone: '', email: 'pat@example.com' },
    { id: '3', name: 'Trashed Jack', phone: '', email: '', deleted_at: '2026-10-01' },
  ]
  assert.deepEqual(pickerList(base, [], '').map((c) => c.id), ['1', '2'])
  assert.deepEqual(pickerList(base, [], 'jack').map((c) => c.id), ['1'])
  assert.deepEqual(pickerList(base, [], '5550100').map((c) => c.id), ['1'])
  // an older lead only the server found joins the list once
  assert.deepEqual(pickerList(base, [{ id: '9', name: 'Jack Old' }, { id: '1', name: 'Jack Daouly' }], 'jack').map((c) => c.id), ['1', '9'])
})

test('attachDesign: only an unassigned design moves; its link follows the lead; a race says so', async () => {
  const calls = []
  const SIBS = [
    { id: 'd1', name: 'Pat', phone: '', email: '' },
    { id: 'd7', name: 'pat', phone: '', email: '' },          // same sender: moves
    { id: 'd8', name: 'Someone Else', phone: '', email: '' }, // forwarded link: stays
  ]
  const sb = (updated) => ({
    from: (t) => {
      const c = { t, ops: [] }
      calls.push(c)
      const b = {
        update: (p) => { c.ops.push(['update', p]); return b },
        insert: async (p) => { c.ops.push(['insert', p]); return { error: null } },
        eq: (k, v) => { c.ops.push(['eq', k, v]); return b },
        neq: (k, v) => { c.ops.push(['neq', k, v]); return b },
        in: (k, v) => { c.ops.push(['in', k, v]); return b },
        is: (k, v) => { c.ops.push(['is', k, v]); return b },
        select: (cols) => {
          c.ops.push(['select', cols])
          if (c.ops[0][0] === 'select') return b // a read: the siblings
          return Promise.resolve({ data: c.ops.some((o) => o[0] === 'in') ? [{ id: 'd7' }] : updated, error: null })
        },
        then: (res) => res(c.ops[0][0] === 'select' ? { data: SIBS, error: null } : { error: null }),
      }
      return b
    },
  })
  await attachDesign(sb([{ id: 'd1' }]), { id: 'd1', name: 'Pat', link_token: 'TOKEN_abcdefghijklmnop' }, 'C2', 'U1')
  const upd = calls.find((c) => c.t === 'design_requests')
  assert.deepEqual(upd.ops.filter((o) => o[0] !== 'update' && o[0] !== 'select'), [['eq', 'id', 'd1'], ['is', 'client_id', null]])
  // the link follows the lead (also a link whose lead went to Trash)
  const link = calls.find((c) => c.t === 'design_links' && c.ops[0][0] === 'update')
  assert.deepEqual(link.ops, [['update', { client_id: 'C2' }], ['eq', 'token', 'TOKEN_abcdefghijklmnop']])
  // the same customer's other waiting sends from that link go with it (never a removed one, never another sender)
  const read = calls.filter((c) => c.t === 'design_requests')[1]
  assert.deepEqual(read.ops.slice(1), [['eq', 'link_token', 'TOKEN_abcdefghijklmnop'], ['is', 'client_id', null], ['neq', 'status', 'dismissed']])
  const move = calls.filter((c) => c.t === 'design_requests')[2]
  assert.deepEqual(move.ops.slice(0, 3), [['update', { client_id: 'C2' }], ['in', 'id', ['d7']], ['is', 'client_id', null]])
  const act = calls.find((c) => c.t === 'activities')
  assert.ok(act.ops[0][1].body.includes('sent by "Pat" (+1 more from the same link)'), act.ops[0][1].body)
  // a design from a SHARED link (contractor / Facebook): the link is never tied to the lead
  calls.length = 0
  await attachDesign(sb([{ id: 'd1' }]), { id: 'd1', name: 'Pat', link_token: 'TOKEN_abcdefghijklmnop', design_links: { kind: 'shared', label: 'ABC Concrete' } }, 'C2', 'U1')
  assert.equal(calls.filter((c) => c.t === 'design_links').length, 0)
  // ... and other people's waiting designs from that shared link stay where they are
  assert.equal(calls.filter((c) => c.t === 'design_requests').length, 1)
  calls.length = 0
  await assert.rejects(attachDesign(sb([]), { id: 'd1', name: 'Pat' }, 'C3', 'U2'), (e) => e.alreadyAttached === true)
  assert.equal(calls.filter((c) => c.t === 'activities').length, 0) // nothing written for the race loser
})

test('sameSender: phone, email or name', () => {
  assert.ok(sameSender({ phone: '(561) 555-0100' }, { phone: '561-555-0100' }))
  assert.ok(sameSender({ email: 'A@B.co' }, { email: 'a@b.co' }))
  assert.ok(sameSender({ name: 'Pat Sample' }, { name: ' pat sample ' }))
  assert.ok(!sameSender({ name: 'Pat', phone: '5615550100' }, { name: 'Sam', phone: '7725550199' }))
  assert.ok(!sameSender({}, {}))
})

test('shared links: the message, the name rule, "From:"', () => {
  const m = sharedLinkMessage({ url: 'https://x/?t=1' })
  assert.match(m, /Send to my steel building rep/)
  assert.doesNotMatch(m, /crm/i)
  assert.doesNotMatch(m, /^Hi /)
  assert.ok(sharedLabelOk('ABC Concrete'))
  assert.ok(sharedLabelOk("Mike's Concrete & Pavers"))
  assert.ok(!sharedLabelOk(''))
  assert.ok(!sharedLabelOk('<b>x</b>'))
  assert.ok(!sharedLabelOk('x'.repeat(81)))
  assert.equal(sharedFrom({ design_links: { kind: 'shared', label: 'Facebook Messenger' } }), 'Facebook Messenger')
  assert.equal(sharedFrom({ design_links: { kind: 'lead', label: null } }), '')
  assert.equal(sharedFrom({}), '')
})

test('createDesignLink: a shared link carries its kind, name and 2-year end; friendly error before 021', async () => {
  const rows = []
  const sb = { from: () => ({ insert: async (row) => { rows.push(row); return { error: null } } }) }
  await createDesignLink(sb, { userId: 'U1', kind: 'shared', label: '  ABC Concrete ' })
  assert.equal(rows[0].kind, 'shared')
  assert.equal(rows[0].label, 'ABC Concrete')
  assert.equal(rows[0].client_id, null)
  const days = (new Date(rows[0].expires_at) - Date.now()) / 86400000
  assert.ok(days > 729 && days < 731, String(days))
  const sbOld = { from: () => ({ insert: async () => ({ error: { code: 'PGRST204', message: "Could not find the 'kind' column of 'design_links' in the schema cache" } }) }) }
  await assert.rejects(createDesignLink(sbOld, { kind: 'shared', label: 'X' }), /021_design_links_shared/)
})

test('designImage: a picture loads once, only a real JPEG data URL', async () => {
  let calls = 0
  const sb = (image) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { calls++; return { data: { image }, error: null } } }) }) }) })
  const good = 'data:image/jpeg;base64,QUJD'
  assert.equal(await designImage(sb(good), 'id-1'), good)
  assert.equal(await designImage(sb(good), 'id-1'), good)
  assert.equal(calls, 1) // the second time comes from the cache
  assert.equal(await designImage(sb('javascript:alert(1)'), 'id-2'), null)
})

// ── links that start on the lead's own building (owner 10/20/26, migration 024) ─────────────────────────────

import {
  seededLinkMessage, SEED_MISSING_TEXT, logDesignLink, loadLeadQuotesForPicker, quotePickerReason, designSeed,
} from '../src/lib/designLinks.js'

const SEED = { schema: 'ss-web-design', v: 1, design: { type: 'garage', width: 24, length: 30, height: 10, openings: [], leanTos: [], wraps: [] }, ctx: { zip: '33401', county: 'Palm Beach', impact: true } }

test('a seeded link carries the seed and where it came from; the plain row stays exactly three keys', async () => {
  const rows = []
  const sb = { from: () => ({ insert: async (row) => { rows.push(row); return { error: null } } }) }
  await createDesignLink(sb, { clientId: 'C1', userId: 'U1' })
  assert.deepEqual(Object.keys(rows[0]).sort(), ['client_id', 'created_by', 'token'])
  await createDesignLink(sb, { clientId: 'C1', userId: 'U1', seed: SEED, seedQuoteId: 'Q1', seedQuoteNumber: 'SS-2026-0042', seedNotes: ['Lap siding is not on the page.'] })
  assert.deepEqual(Object.keys(rows[1]).sort(), ['client_id', 'created_by', 'seed', 'seed_notes', 'seed_quote_id', 'seed_quote_number', 'token'])
  assert.equal(rows[1].seed, SEED)
  assert.equal(rows[1].seed_quote_number, 'SS-2026-0042')
  // only what was given is sent
  await createDesignLink(sb, { clientId: 'C1', userId: 'U1', seed: SEED })
  assert.deepEqual(Object.keys(rows[2]).sort(), ['client_id', 'created_by', 'seed', 'token'])
  // a shared link never gets a seed, even if one is passed
  await createDesignLink(sb, { kind: 'shared', label: 'ABC Concrete', userId: 'U1', seed: SEED })
  assert.ok(!('seed' in rows[3]))
})

test('a seeded link is never made plain: a missing seed column is a clear error, not a seedless link', async () => {
  const attempts = []
  const missing = { code: 'PGRST204', message: "Could not find the 'seed' column of 'design_links' in the schema cache" }
  const sb = { from: () => ({ insert: async (row) => { attempts.push(row); return { error: missing } } }) }
  await assert.rejects(createDesignLink(sb, { clientId: 'C1', userId: 'U1', seed: SEED }), (e) => e.message === SEED_MISSING_TEXT && /024_design_link_seed\.sql/.test(e.message) && e.seedMissing === true && e.missingTable === false)
  assert.equal(attempts.length, 1) // one try, no retry without the seed
  assert.ok('seed' in attempts[0])
  const pg = { from: () => ({ insert: async () => ({ error: { code: '42703', message: 'column "seed" of relation "design_links" does not exist' } }) }) }
  await assert.rejects(createDesignLink(pg, { clientId: 'C1', seed: SEED }), (e) => e.message === SEED_MISSING_TEXT)
  // a plain link still reports the old messages
  await assert.rejects(createDesignLink({ from: () => ({ insert: async () => ({ error: { code: '42P01', message: 'relation "design_links" does not exist' } }) }) }, {}), (e) => e.missingTable === true && /020_design_links/.test(e.message))
})

test('seeded message: customer wording (no prices, CRM or maker words); the plain message is unchanged', () => {
  const m = seededLinkMessage({ clientName: 'Jack Daouly', repName: 'Jenna Shiebler', url: 'https://x/?t=1' })
  assert.match(m, /^Hi Jack, it's Jenna with StormSafe Steel\./)
  assert.match(m, /Send to my steel building rep/)
  assert.match(m, /Here's your building in 3D/)
  assert.match(m, /https:\/\/x\/\?t=1$/)
  assert.doesNotMatch(m, /crm|\$\s?\d|quote #|carolina|carports anywhere|\bCCI\b|\bCA\b/i)
  assert.match(seededLinkMessage({ clientName: '', repName: '', url: 'u' }), /^Hi, it's your rep at StormSafe Steel\./)
  // byte-identical plain message
  assert.equal(designLinkMessage({ clientName: 'Jack Daouly', repName: 'Jenna Shiebler', url: 'https://x/?t=1' }),
    "Hi Jack, it's Jenna with StormSafe Steel. Here's a link to design your building in 3D: pick the size, walls, doors, windows and colors, then tap \"Send to my steel building rep\" and it comes straight to me. No prices on it; I'll put your quote together from your design.\n\nhttps://x/?t=1")
})

test('the timeline entry names the quote only for a seeded link', async () => {
  const logged = []
  const sb = { from: () => ({ insert: async (r) => { logged.push(r); return {} } }) }
  await logDesignLink(sb, { clientId: 'C1', userId: 'U1', url: 'https://x/?t=1' })
  assert.equal(logged[0].body, 'Design link created: https://x/?t=1')
  assert.deepEqual(logged[0].metadata, { kind: 'design_link' })
  await logDesignLink(sb, { clientId: 'C1', userId: 'U1', url: 'https://x/?t=2', quoteId: 'Q1', quoteNumber: 'SS-2026-0042' })
  assert.equal(logged[1].body, 'Design link created from quote #SS-2026-0042: https://x/?t=2')
  assert.deepEqual(logged[1].metadata, { kind: 'design_link', quote_id: 'Q1', quote_number: 'SS-2026-0042' })
})

test('lead quotes for the picker: light columns, steps down on an older database, Trash left out, never a payload', async () => {
  const seen = []
  const rowsAll = [{ id: 'a', quote_number: 'SS-1', status: 'sent', bt: 'standard' }, { id: 'b', quote_number: 'SS-2', status: 'draft', deleted_at: '2026-10-01', bt: 'gch' }, { id: 'c', quote_number: 'SS-3', status: 'superseded', bt: null }]
  const sb = {
    from: (t) => {
      assert.equal(t, 'quotes')
      return {
        select(cols) { seen.push(cols); this.cols = cols; return this },
        eq(k, v) { assert.deepEqual([k, v], ['client_id', 'C1']); return this },
        async limit() { return /bt:payload_json/.test(this.cols) ? { data: null, error: { code: '42703', message: 'column quotes.starred does not exist' } } : { data: rowsAll, error: null } },
      }
    },
  }
  const r = await loadLeadQuotesForPicker(sb, 'C1')
  assert.equal(r.error, null)
  assert.deepEqual(r.rows.map((x) => x.id), ['a', 'c']) // the one in Trash is gone, the replaced one is kept for its own group
  assert.ok(seen.length >= 2 && /bt:payload_json->fields->>btype/.test(seen[0]))
  assert.ok(seen.every((c) => !/payload_json(?!->)/.test(c) && !/\*/.test(c)), seen.join(' || '))
  // a real error (not a missing column) is reported, not swallowed into the next set
  const bad = { from: () => ({ select() { return this }, eq() { return this }, limit: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }) }
  const e = await loadLeadQuotesForPicker(bad, 'C1')
  assert.deepEqual(e.rows, [])
  assert.equal(e.error.code, '57014')
  // why a row is greyed out
  assert.match(quotePickerReason({ bt: null }), /no saved building/)
  assert.match(quotePickerReason({ bt: 'fslean' }), /Free-standing/)
  assert.equal(quotePickerReason({ bt: 'gch' }), '')
  assert.equal(quotePickerReason({}), '') // this database cannot tell: the full payload is checked on confirm
})

test('designSeed: read once per link and cached; a missing column or no row means no seed (and is not cached)', async () => {
  const TOK = 'seedtok_' + 'a'.repeat(16)
  let calls = 0
  const sb = {
    from: (t) => {
      assert.equal(t, 'design_links')
      return {
        select(cols) { assert.equal(cols, 'seed, seed_quote_number, seed_notes'); return this },
        eq(k, v) { assert.deepEqual([k, v], ['token', TOK]); return this },
        maybeSingle: async () => { calls++; return { data: { seed: SEED, seed_quote_number: 'SS-2026-0042', seed_notes: ['Lap siding is not on the page.', 7] }, error: null } },
      }
    },
  }
  const a = await designSeed(sb, TOK)
  const b = await designSeed(sb, TOK)
  assert.equal(calls, 1)
  assert.equal(a, b)
  assert.deepEqual([a.seed.schema, a.quoteNumber, a.notes], ['ss-web-design', 'SS-2026-0042', ['Lap siding is not on the page.']])
  // a plain link: no seed (cached - the link will not grow one)
  const T2 = 'plaintk_' + 'b'.repeat(16)
  let c2 = 0
  const plain = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => { c2++; return { data: { seed: null, seed_quote_number: null, seed_notes: null }, error: null } } }) }
  assert.equal((await designSeed(plain, T2)).seed, null)
  await designSeed(plain, T2)
  assert.equal(c2, 1)
  // before migration 024: the column is missing -> no seed, asked again later
  const T3 = 'oldsql_' + 'c'.repeat(17)
  let c3 = 0
  const old = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => { c3++; return { data: null, error: { code: '42703', message: 'column design_links.seed does not exist' } } } }) }
  assert.equal((await designSeed(old, T3)).seed, null)
  await designSeed(old, T3)
  assert.equal(c3, 2)
  // nothing to ask for
  assert.equal((await designSeed(sb, null)).seed, null)
  assert.equal((await designSeed(sb, 'short')).seed, null)
})
