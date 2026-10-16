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
  const me = firstName(repName) ? `it's ${firstName(repName)} with StormSafe Steel` : `it's StormSafe Steel`
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

const LIST_COLS = 'id, created_at, client_id, name, phone, email, zip, notes, spec, image, status, design'

/** A lead's received designs, newest first. { rows, missing } */
export async function loadClientDesigns(sb, clientId) {
  const { data, error } = await sb.from('design_requests').select(LIST_COLS)
    .eq('client_id', clientId).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(25)
  if (error) return { rows: [], missing: isMissingTable(error), error }
  return { rows: data || [], missing: false }
}

/** Designs sent from a link that is not tied to a lead, not dismissed. { rows, missing } */
export async function loadUnassignedDesigns(sb) {
  const { data, error } = await sb.from('design_requests').select(LIST_COLS)
    .is('client_id', null).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(50)
  if (error) return { rows: [], missing: isMissingTable(error), error }
  return { rows: data || [], missing: false }
}

export async function markDesign(sb, id, patch, userId) {
  const { error } = await sb.from('design_requests')
    .update({ ...patch, handled_by: userId ?? null, handled_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/** Attach an unassigned design to a lead (+ the lead's timeline entry). */
export async function attachDesign(sb, design, clientId, userId) {
  await markDesign(sb, design.id, { client_id: clientId, status: 'seen' }, userId)
  await sb.from('activities').insert({
    client_id: clientId,
    type: 'note',
    body: `Customer design attached to this lead (sent by ${design.name}). See Customer Designs.`,
    metadata: { kind: 'design_request', design_request_id: design.id },
    created_by: userId ?? null,
  })
}

const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10)

/** Leads that look like the sender (same phone or email, else same name). */
export function matchLeads(design, leads) {
  const p = digits(design.phone), e = String(design.email || '').trim().toLowerCase(), n = String(design.name || '').trim().toLowerCase()
  const score = (c) => {
    if (p.length === 10 && digits(c.phone) === p) return 3
    if (e && String(c.email || '').trim().toLowerCase() === e) return 3
    if (n && String(c.name || '').trim().toLowerCase() === n) return 1
    return 0
  }
  return leads.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c)
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
