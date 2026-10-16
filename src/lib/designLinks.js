// Customer design links (owner 10/16/26). A rep sends a lead a personal link to
// the no-price 3D design page; the customer designs the building and taps
// "Send to my steel building rep"; the design lands on that lead (Customer
// Designs card). Tables + the public intake function: db/migrations/020_design_links.sql.
//
// The link token is random (18 bytes, 24 URL-safe characters) and says nothing
// about the lead. Customers never see the word "CRM".

export const DESIGN_SITE = 'https://stormsafe-design.pages.dev/'
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 24-character URL-safe random token (crypto.getRandomValues). */
export function newToken(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const b = rand(18)
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]
    s += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63]
  }
  return s
}

export const designLinkUrl = (token) => `${DESIGN_SITE}?t=${token}`

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

/** The text the rep sends with the link (editable in the dialog). */
export function designLinkMessage({ clientName, repName, url }) {
  const hi = firstName(clientName) ? `Hi ${firstName(clientName)}` : 'Hi'
  const me = firstName(repName) ? `it's ${firstName(repName)} with StormSafe Steel` : `it's your rep at StormSafe Steel`
  return `${hi}, ${me}. Here's a link to design your building in 3D: pick the size, walls, doors, windows and colors, then tap "Send to my steel building rep" and it comes straight to me. No prices on it; I'll put your quote together from your design.\n\n${url}`
}

/** The table is not there yet (the owner has not run migration 020). */
export function isMissingTable(error) {
  if (!error) return false
  const code = String(error.code || '')
  const m = String(error.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === 'PGRST202' ||
    ((m.includes('design_links') || m.includes('design_requests')) && (m.includes('does not exist') || m.includes('schema cache') || m.includes('could not find')))
}

export const MISSING_TABLE_TEXT = 'Design links need the one-time database update first (db/migrations/020_design_links.sql in the Supabase SQL editor).'

export const SHARED_MISSING_TEXT = 'Shared links need the one-time database update first (db/migrations/021_design_links_shared.sql in the Supabase SQL editor).'
/** Days a shared link works (contractors / Facebook pass it around for a long time). */
export const SHARED_LINK_DAYS = 730

/**
 * Make a link. kind 'lead': one person (clientId = their lead, or null = not a
 * lead yet). kind 'shared' (owner 10/16/26): passed around by a concrete
 * contractor / Facebook Messenger to many people - a name (label), never tied
 * to a lead, 2 years (migration 021).
 */
export async function createDesignLink(sb, { clientId = null, userId = null, kind = 'lead', label = '', rand } = {}) {
  const token = newToken(rand)
  const shared = kind === 'shared'
  const row = shared
    ? { token, client_id: null, created_by: userId, kind: 'shared', label: String(label).trim().slice(0, 80), expires_at: new Date(Date.now() + SHARED_LINK_DAYS * 86400000).toISOString() }
    : { token, client_id: clientId, created_by: userId }
  const { error } = await sb.from('design_links').insert(row)
  if (error) {
    const m = String(error.message || '')
    const sharedMissing = shared && (error.code === '42703' || /'?(kind|label)'? column|column .*(kind|label)/i.test(m))
    const e = new Error(sharedMissing ? SHARED_MISSING_TEXT : isMissingTable(error) ? MISSING_TABLE_TEXT : m || 'Could not make the link.')
    e.missingTable = !sharedMissing && isMissingTable(error)
    throw e
  }
  return { token, url: designLinkUrl(token) }
}

/** The text to post / send with a shared link (no name: it goes to many people). */
export function sharedLinkMessage({ url }) {
  return `Design your steel building in 3D: pick the size, walls, doors, windows and colors, then tap "Send to my steel building rep" and it comes straight to StormSafe Steel. No prices on it; we'll put your quote together from your design.\n\n${url}`
}

/** A shared link's name: letters, numbers and simple punctuation, 1-80 characters (same rule as the database). */
export const sharedLabelOk = (s) => { const t = String(s || '').trim(); return t.length >= 1 && t.length <= 80 && !/[<>"`]/.test(t) }

/** Shared links (newest first), with how many designs came from each. { links, missing } */
export async function loadSharedLinks(sb) {
  const { data, error } = await sb.from('design_links').select('token, label, created_at, expires_at, revoked_at')
    .eq('kind', 'shared').order('created_at', { ascending: false }).limit(100)
  if (error) return { links: [], missing: true, error }
  const tokens = (data || []).map((l) => l.token)
  const counts = new Map()
  if (tokens.length) {
    const { data: reqs } = await sb.from('design_requests').select('link_token').in('link_token', tokens)
    for (const r of reqs || []) counts.set(r.link_token, (counts.get(r.link_token) || 0) + 1)
  }
  return { links: (data || []).map((l) => ({ ...l, url: designLinkUrl(l.token), designs: counts.get(l.token) || 0 })), missing: false }
}

/** Turn a shared link off (its page then says the link is not active), or back on. */
export async function setSharedLinkOff(sb, token, off) {
  const { error } = await sb.from('design_links').update({ revoked_at: off ? new Date().toISOString() : null }).eq('token', token).eq('kind', 'shared')
  if (error) throw error
}

/** Timeline entry on the lead: who made the link (the customer's send adds its own entry). */
export async function logDesignLink(sb, { clientId, userId, url }) {
  if (!clientId) return
  await sb.from('activities').insert({
    client_id: clientId,
    type: 'note',
    body: `Design link created: ${url}`,
    metadata: { kind: 'design_link' },
    created_by: userId ?? null,
  })
}

const LIST_COLS = 'id, created_at, link_token, client_id, name, phone, email, zip, notes, spec, image, status, design'
// + the link each design came from (kind / name) - migration 021; without it the plain list is used
const LIST_WITH_LINK = `${LIST_COLS}, design_links(kind, label)`

/** A design list query with the link's kind / name when the database has them (021), else without. */
async function listQuery(sb, build) {
  let r = await build(sb.from('design_requests').select(LIST_WITH_LINK))
  if (r.error && (r.error.code === '42703' || /(kind|label)/i.test(String(r.error.message || '')))) r = await build(sb.from('design_requests').select(LIST_COLS))
  return r
}

/** "From ABC Concrete" for a design that came from a shared link, else ''. */
export const sharedFrom = (d) => (d && d.design_links && d.design_links.kind === 'shared' ? String(d.design_links.label || 'a shared link') : '')

/** A lead's received designs, newest first. { rows, missing } */
export async function loadClientDesigns(sb, clientId) {
  const { data, error } = await listQuery(sb, (q) => q.eq('client_id', clientId).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(10))
  if (error) return { rows: [], missing: isMissingTable(error), error }
  return { rows: data || [], missing: false }
}

/**
 * Designs sent from a link that is not tied to a lead, not dismissed. { rows, missing }
 * light: ids only (the Leads page strip just counts them; the pictures load when Review opens).
 */
export async function loadUnassignedDesigns(sb, { light = false } = {}) {
  const { data, error } = await sb.from('design_requests').select(light ? 'id' : LIST_COLS)
    .is('client_id', null).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(20)
  if (error) return { rows: [], missing: isMissingTable(error), error }
  return { rows: data || [], missing: false }
}

export async function markDesign(sb, id, patch, userId) {
  const { error } = await sb.from('design_requests')
    .update({ ...patch, handled_by: userId ?? null, handled_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/**
 * Attach an unassigned design to a lead (+ the lead's timeline entry). Only a
 * design that is still unassigned moves (another rep may have just attached
 * it: then this throws "already attached" and writes nothing). The link it came
 * from is tied to the lead too (also a link whose lead went to Trash), so that
 * customer's next send lands on the lead, and their other waiting sends from the
 * same link go with it.
 */
export async function attachDesign(sb, design, clientId, userId) {
  const { data, error } = await sb.from('design_requests')
    .update({ client_id: clientId, status: 'seen', handled_by: userId ?? null, handled_at: new Date().toISOString() })
    .eq('id', design.id).is('client_id', null).select('id')
  if (error) throw error
  if (!data || !data.length) {
    const e = new Error('This design was already attached to a lead (maybe by someone else just now).')
    e.alreadyAttached = true
    throw e
  }
  let more = 0
  if (design.link_token) {
    // a SHARED link (contractor / Facebook) stays shared: it is never tied to one lead
    let shared = design.design_links ? design.design_links.kind === 'shared' : false
    if (!design.design_links) {
      try {
        const { data: lk, error: le } = await sb.from('design_links').select('kind').eq('token', design.link_token).maybeSingle()
        shared = !le && !!lk && lk.kind === 'shared'
      } catch { /* before 021 there are no shared links */ }
    }
    if (!shared) {
      try { await sb.from('design_links').update({ client_id: clientId }).eq('token', design.link_token) } catch { /* the design itself is attached */ }
    }
    // the same customer's other waiting sends from this link go with it (same phone / email / name;
    // never a removed one, never someone else the link was forwarded to)
    try {
      const { data: sib } = await sb.from('design_requests').select('id, name, phone, email, status')
        .eq('link_token', design.link_token).is('client_id', null).neq('status', 'dismissed')
      const ids = (sib || []).filter((x) => x.id !== design.id && sameSender(x, design)).map((x) => x.id)
      if (ids.length) {
        const { data: moved } = await sb.from('design_requests').update({ client_id: clientId }).in('id', ids).is('client_id', null).select('id')
        more = (moved || []).length
      }
    } catch { /* the chosen design is attached; others can still be attached by hand */ }
  }
  await sb.from('activities').insert({
    client_id: clientId,
    type: 'note',
    body: `Customer design attached to this lead, sent by "${design.name}"${more ? ` (+${more} more from the same link)` : ''}. See Customer Designs.`,
    metadata: { kind: 'design_request', design_request_id: design.id },
    created_by: userId ?? null,
  })
}

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10)

/** Two sends from the same person: same 10-digit phone, same email, or the same name. */
export function sameSender(a, b) {
  const pa = digits(a.phone), pb = digits(b.phone)
  if (pa.length === 10 && pa === pb) return true
  const ea = String(a.email || '').trim().toLowerCase(), eb = String(b.email || '').trim().toLowerCase()
  if (ea && ea === eb) return true
  const na = String(a.name || '').trim().toLowerCase(), nb = String(b.name || '').trim().toLowerCase()
  return !!na && na === nb
}

/** A search box value made safe for a PostgREST or() filter (letters, digits, space, @ . - _ ' only). */
export const searchTerm = (q) => String(q || '').replace(/[^A-Za-z0-9 @._'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

/**
 * Leads for a picker, newest first, never the ones in Trash (deleted_at, migration
 * 017 — read when the column exists). With a search term, the server searches
 * name and email across ALL leads (not only the newest).
 */
export async function loadLeadsForPicker(sb, q = '') {
  const term = searchTerm(q)
  // phones are stored as typed ("(561) 555-0147", "561-555-0147"): 7+ digits match with anything between them
  const dg = term.replace(/\D/g, '')
  const phonePat = dg.length >= 7 ? dg.split('').join('*') : term
  const run = (cols) => {
    let req = sb.from('clients').select(cols).order('updated_at', { ascending: false }).limit(term ? 60 : 1000)
    if (term) req = req.or(`name.ilike."*${term}*",email.ilike."*${term}*",phone.ilike."*${phonePat}*"`)
    return req
  }
  let r = await run('id, name, phone, email, status, updated_at, deleted_at')
  if (r.error && /deleted_at/i.test(r.error.message || '')) r = await run('id, name, phone, email, status, updated_at')
  if (r.error) throw r.error
  // keep only real matches (the loose phone pattern can catch a few others)
  const t = term.toLowerCase()
  return (r.data || []).filter((c) => !c.deleted_at && (!term ||
    String(c.name || '').toLowerCase().includes(t) || String(c.email || '').toLowerCase().includes(t) ||
    (dg.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(dg))))
}

/** Leads that look like the sender (same phone or email, else same name). Leads in Trash never match. */
export function matchLeads(design, leads) {
  const p = digits(design.phone), e = String(design.email || '').trim().toLowerCase(), n = String(design.name || '').trim().toLowerCase()
  const score = (c) => {
    if (p.length === 10 && digits(c.phone) === p) return 3
    if (e && String(c.email || '').trim().toLowerCase() === e) return 3
    if (n && String(c.name || '').trim().toLowerCase() === n) return 1
    return 0
  }
  return leads.filter((c) => !c.deleted_at).map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c)
}

/** "data:image/jpeg;base64,…" only — never anything else in an <img src>. */
export const safeImage = (s) => (typeof s === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : null)

/** Building line from the saved design: "Garage 24' × 30' × 10' (W × L × H) + 1 lean-to". */
export function designSummary(d) {
  const x = d && d.design
  if (!x || typeof x !== 'object') return ''
  const type = { garage: 'Garage', carport: 'Carport', combo: 'Garage + Carport' }[x.type] || 'Building'
  const dims = [x.width, x.length, x.height].every((v) => Number.isFinite(Number(v))) ? ` ${Number(x.width)}' × ${Number(x.length)}' × ${Number(x.height)}' (W × L × H)` : ''
  const lt = Array.isArray(x.leanTos) && x.leanTos.length ? ` + ${x.leanTos.length === 1 ? '1 lean-to' : `${x.leanTos.length} lean-tos`}` : ''
  return `${type}${dims}${lt}`
}

/** For toast() (it renders HTML): customer-typed text must never become markup. */
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** The picker list: newest leads (no search), or the local name / email / phone-digit matches plus the server's matches. */
export function pickerList(base, remote, search, max = 30) {
  const q = String(search || '').trim().toLowerCase()
  const qd = q.replace(/\D/g, '')
  const list = (base || []).filter((c) => !c.deleted_at)
  if (!q) return list.slice(0, max)
  const hit = (c) => String(c.name || '').toLowerCase().includes(q) || String(c.email || '').toLowerCase().includes(q) ||
    (qd.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(qd))
  const seen = new Set()
  const out = []
  for (const c of [...list.filter(hit), ...(remote || []).filter((c) => !c.deleted_at)]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out.slice(0, max)
}

/** Customer Designs page views (owner 10/16/26: every design lands there, on a lead or not). */
export const DESIGN_VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'waiting', label: 'Not on a lead' },
  { key: 'all', label: 'All' },
  { key: 'removed', label: 'Removed' },
  { key: 'shared', label: 'Shared links' },
]

/** One view of the designs, newest first. { rows, missing, error } */
export async function loadDesigns(sb, view = 'new', limit = 30) {
  const { data, error } = await listQuery(sb, (req) => {
    if (view === 'new') req = req.eq('status', 'new')
    else if (view === 'waiting') req = req.is('client_id', null).neq('status', 'dismissed')
    else if (view === 'removed') req = req.eq('status', 'dismissed')
    else req = req.neq('status', 'dismissed')
    return req.order('created_at', { ascending: false }).limit(limit)
  })
  if (error) return { rows: [], missing: isMissingTable(error), error }
  return { rows: data || [], missing: false }
}

/** How many are new, and how many are not on a lead (not removed). { fresh, waiting } (0 / 0 before migration 020) */
export async function countDesigns(sb) {
  const count = async (build) => {
    const { count: n, error } = await build(sb.from('design_requests').select('id', { count: 'exact', head: true }))
    return error ? 0 : n || 0
  }
  const [fresh, waiting] = await Promise.all([
    count((q) => q.eq('status', 'new')),
    count((q) => q.is('client_id', null).neq('status', 'dismissed')),
  ])
  return { fresh, waiting }
}

/** Lead names for the designs that are on a lead: Map id -> name. */
export async function loadLeadNames(sb, ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return new Map()
  const { data } = await sb.from('clients').select('id, name').in('id', list)
  return new Map((data || []).map((c) => [c.id, c.name]))
}
