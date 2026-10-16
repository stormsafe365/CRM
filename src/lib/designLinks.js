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

/** Make a link for a lead (clientId null = not tied to a lead yet; the design shows under Leads › Customer designs). */
export async function createDesignLink(sb, { clientId = null, userId = null, rand } = {}) {
  const token = newToken(rand)
  const { error } = await sb.from('design_links').insert({ token, client_id: clientId, created_by: userId })
  if (error) {
    const e = new Error(isMissingTable(error) ? MISSING_TABLE_TEXT : error.message || 'Could not make the link.')
    e.missingTable = isMissingTable(error)
    throw e
  }
  return { token, url: designLinkUrl(token) }
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

/** A lead's received designs, newest first. { rows, missing } */
export async function loadClientDesigns(sb, clientId) {
  const { data, error } = await sb.from('design_requests').select(LIST_COLS)
    .eq('client_id', clientId).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(10)
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
  if (design.link_token) {
    try { await sb.from('design_links').update({ client_id: clientId }).eq('token', design.link_token) } catch { /* the design itself is attached */ }
    try {
      await sb.from('design_requests').update({ client_id: clientId }).eq('link_token', design.link_token).is('client_id', null)
    } catch { /* the chosen design is attached; others can still be attached by hand */ }
  }
  await sb.from('activities').insert({
    client_id: clientId,
    type: 'note',
    body: `Customer design attached to this lead, sent by "${design.name}". See Customer Designs.`,
    metadata: { kind: 'design_request', design_request_id: design.id },
    created_by: userId ?? null,
  })
}

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10)

/** A search box value made safe for a PostgREST or() filter (letters, digits, space, @ . - _ ' only). */
export const searchTerm = (q) => String(q || '').replace(/[^A-Za-z0-9 @._'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

/**
 * Leads for a picker, newest first, never the ones in Trash (deleted_at, migration
 * 017 — read when the column exists). With a search term, the server searches
 * name and email across ALL leads (not only the newest).
 */
export async function loadLeadsForPicker(sb, q = '') {
  const term = searchTerm(q)
  const run = (cols) => {
    let req = sb.from('clients').select(cols).order('updated_at', { ascending: false }).limit(term ? 60 : 1000)
    if (term) req = req.or(`name.ilike."*${term}*",email.ilike."*${term}*",phone.ilike."*${term}*"`)
    return req
  }
  let r = await run('id, name, phone, email, status, updated_at, deleted_at')
  if (r.error && /deleted_at/i.test(r.error.message || '')) r = await run('id, name, phone, email, status, updated_at')
  if (r.error) throw r.error
  return (r.data || []).filter((c) => !c.deleted_at)
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
