// perfLoad: reads everything the Performance page counts (perfStats.js does the counting).
// Supabase hands out at most 1000 rows per read, so every table is read in pages until the row count
// is reached; a read that comes up short is an ERROR on the page, never a quietly smaller number.
// Only the columns the numbers need are read (no quote documents, no pictures). Columns a database
// may not have yet (Trash 017, star 019) fall back like the rest of the app; the deposit table (022)
// missing = "deposits not tracked yet".

import { SAMPLE_NOTE, TOUCH_TYPES } from './perfStats.js'

export const PAGE = 1000
const MAX_PAGES = 200
// a column / JSON path / table this database does not have
const SCHEMA_CODES = new Set(['42703', '42883', 'PGRST100', 'PGRST204'])
const NO_TABLE = new Set(['42P01', 'PGRST205', 'PGRST202'])
const schemaMiss = (e) => !!e && (SCHEMA_CODES.has(e.code) || /column .* does not exist|schema cache/i.test(String(e.message || '')))
export const tableMissing = (e) => !!e && (NO_TABLE.has(e.code) || /relation .* does not exist|could not find the table/i.test(String(e.message || '')))

/** Every row of `table` matching `filter`, paged; { rows } or { error }. Never a short list. */
export async function readAll(sb, table, cols, filter = (q) => q) {
  const byId = new Map()
  let total = null
  for (let page = 0, from = 0; page < MAX_PAGES; page++) {
    const { data, error, count } = await filter(sb.from(table).select(cols, { count: 'exact' })).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) return { error }
    const got = data || []
    if (count != null) total = count
    for (const r of got) byId.set(r.id, r) // a row added mid-read can repeat at a page edge: keep one
    from += got.length
    const done = !got.length || (total != null ? from >= total : got.length < PAGE)
    if (done) {
      if (total != null && byId.size < total && from < total) return { error: { message: `Only ${byId.size} of ${total} ${table} rows could be read.` } }
      return { rows: [...byId.values()] }
    }
  }
  return { error: { message: `Too many ${table} rows to read (over ${PAGE * MAX_PAGES}).` } }
}

/** The first column set this database knows (a missing column moves to the next; any other error stops). */
async function readFirst(sb, table, colSets, filter) {
  let last = null
  for (const cols of colSets) {
    const r = await readAll(sb, table, cols, filter)
    if (!r.error) return { ...r, cols }
    if (!schemaMiss(r.error)) return r
    last = r
  }
  return last
}

const CLIENT_COLS = 'id, name, phone, email, status, primary_rep, source, created_at, first_contact_date, order_date'
const QUOTE_COLS = 'id, client_id, created_at, status, total_amount, parent_quote_id, quote_number'

/**
 * { data } for computePerformance, or { error: 'what could not be read' }.
 * data.payments = null when the deposit table (022) is not there yet.
 */
export async function loadPerformance(sb) {
  const fail = (what, e) => ({ error: `Could not read ${what}: ${e?.message || 'try again'}` })
  const [users, clients, sample, quotes, touches, changes, payments] = await Promise.all([
    readAll(sb, 'users', 'id, display_name, email'),
    readFirst(sb, 'clients', [`${CLIENT_COLS}, deleted_at`, CLIENT_COLS]),
    readAll(sb, 'clients', 'id', (q) => q.eq('notes', SAMPLE_NOTE)),
    readFirst(sb, 'quotes', [`${QUOTE_COLS}, deleted_at, starred`, `${QUOTE_COLS}, deleted_at`, `${QUOTE_COLS}, starred`, QUOTE_COLS]),
    readAll(sb, 'activities', 'id, client_id, type, created_by, created_at, kind:metadata->>kind', (q) => q.in('type', TOUCH_TYPES).not('created_by', 'is', null)),
    readAll(sb, 'activities', 'id, client_id, created_by, created_at, to:metadata->>to', (q) => q.eq('type', 'status_change').not('created_by', 'is', null)),
    readAll(sb, 'payments', 'id, client_id, kind, amount, received_on, method, deleted_at, created_at'),
  ])
  if (users.error) return fail('the reps', users.error)
  if (clients.error) return fail('the leads', clients.error)
  if (sample.error) return fail('the leads', sample.error)
  if (quotes.error) return fail('the quotes', quotes.error)
  if (touches.error) return fail('the follow-ups', touches.error)
  if (changes.error) return fail('the stage changes', changes.error)
  if (payments.error && !tableMissing(payments.error)) return fail('the deposits', payments.error)
  return {
    data: {
      users: users.rows,
      clients: clients.rows,
      sampleIds: sample.rows.map((r) => r.id),
      quotes: quotes.rows,
      touches: touches.rows,
      statusChanges: changes.rows,
      payments: payments.error ? null : payments.rows,
    },
  }
}
