// ClientForm: shared form used by both "New Client" and "Edit Client"
// pages. Receives initial values + an onSubmit callback. Validates that
// 'name' and 'primary_rep' are present; everything else is optional.

import { useRef, useState } from 'react'
import { CLIENT_STATUSES, LEAD_SOURCES, BUILDING_TYPES, PROJECT_STAGES } from '../lib/constants'
import { useUsers } from '../lib/useUsers'

// Rep option label: name plus email, so two accounts with the same display
// name (e.g. a duplicate "Jenna" login) are tell-apart-able in the dropdown.
function repOptionLabel(u) {
  const name = u.display_name || ''
  if (name && u.email) return `${name} — ${u.email}`
  return name || u.email || 'Unknown'
}

// ZIP → City / State / County autofill via two free, no-key public APIs:
//   Zippopotam (zip → city, state, lat/lon) + FCC census area (lat/lon → county).
async function lookupZip(zip5) {
  const r = await fetch(`https://api.zippopotam.us/us/${zip5}`)
  if (!r.ok) return null
  const d = await r.json()
  const p = d.places?.[0]
  if (!p) return null
  const out = { city: p['place name'] || '', state: p['state abbreviation'] || '', county: '' }
  try {
    const fr = await fetch(`https://geo.fcc.gov/api/census/area?lat=${p.latitude}&lon=${p.longitude}&format=json`)
    if (fr.ok) {
      const fd = await fr.json()
      out.county = (fd.results?.[0]?.county_name || '').replace(/\s+(County|Parish|Borough|Census Area)$/i, '')
    }
  } catch { /* county is best-effort; city/state still fill */ }
  return out
}

const EMPTY = {
  name: '', email: '', phone: '',
  address_line: '', city: '', county: '', state: '', zip: '',
  source: '', source_detail: '',
  status: 'new_lead',
  primary_rep: '', secondary_rep: '',
  project_stage: '',
  payment_cleared: false,
  first_contact_date: '',
  follow_up_date: '',
  building_size: '',
  building_type: '',
  building_mfr: '',
  building_features: '',
  estimated_price_range: '',
  notes: '',
}

export default function ClientForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const { users } = useUsers()
  const [form, setForm] = useState({ ...EMPTY, ...(initial ?? {}) })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [zipBusy, setZipBusy] = useState(false)
  const [zipMsg, setZipMsg] = useState('')
  const lastZip = useRef('')

  // Fire the lookup as soon as a full 5-digit ZIP is present; fill City/State/County.
  function onZipChange(value) {
    update('zip', value)
    const z = (value.match(/\d/g) || []).join('').slice(0, 5)
    if (z.length !== 5) { setZipMsg(''); lastZip.current = ''; return }
    if (lastZip.current === z) return
    lastZip.current = z
    setZipBusy(true); setZipMsg('')
    lookupZip(z)
      .then(res => {
        if (!res) { setZipMsg('ZIP not found — fill in manually'); return }
        setForm(f => ({ ...f, city: res.city, state: res.state, ...(res.county ? { county: res.county } : {}) }))
        setZipMsg(`✓ ${res.city}, ${res.state}${res.county ? ` · ${res.county} County` : ''}`)
      })
      .catch(() => setZipMsg('Lookup failed — fill in manually'))
      .finally(() => setZipBusy(false))
  }

  function update(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }
      // When a client becomes "Ordered", start the project track at 'ordered'.
      if (field === 'status' && value === 'ordered' && !f.project_stage) {
        next.project_stage = 'ordered'
      }
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.name?.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.primary_rep) {
      setError('Primary rep is required.')
      return
    }

    setSubmitting(true)
    // Normalize: empty strings → null for nullable columns so the DB
    // stores NULL instead of '' (cleaner queries, fewer edge cases).
    const payload = {}
    for (const [k, v] of Object.entries(form)) {
      payload[k] = (typeof v === 'string' && v.trim() === '') ? null : v
    }
    // Name is required so trim but don't null it.
    payload.name = form.name.trim()

    // project_stage only matters once a client is "Ordered". When it's
    // empty, drop it from the payload entirely so creating ordinary leads
    // never touches that column (works even before the 004 migration).
    if (payload.project_stage == null) delete payload.project_stage
    if (typeof payload.payment_cleared !== 'boolean') payload.payment_cleared = false

    try {
      await onSubmit(payload)
    } catch (err) {
      const msg = (err?.message || '').toLowerCase()
      // If a newer optional column doesn't exist yet (migration not run),
      // retry the save without those columns so the core save still works.
      const optional = ['project_stage', 'payment_cleared']
      if (msg.includes('schema cache') || optional.some(k => msg.includes(k))) {
        const rest = { ...payload }
        for (const k of optional) delete rest[k]
        try {
          await onSubmit(rest)
          return
        } catch (err2) {
          setError(err2.message || 'Something went wrong.')
          setSubmitting(false)
          return
        }
      }
      // Friendlier message if the new 'Contract Sent' stage isn't in the DB yet.
      if (msg.includes('invalid input value for enum') || msg.includes('contract_sent')) {
        setError('The "Contract Sent" stage needs a one-time database update before it can be saved. For now pick another stage, or run migration 004. (Every other stage works.)')
        setSubmitting(false)
        return
      }
      setError(err.message || 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="client-form">
      <FormSection title="Contact">
        <Field label="Name *">
          <input type="text" value={form.name} onChange={e => update('name', e.target.value)} required autoFocus />
        </Field>
        <Field label="Phone">
          <input type="tel" value={form.phone ?? ''} onChange={e => update('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email ?? ''} onChange={e => update('email', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Building Inquiry">
        <Field label="Building Size">
          <input
            type="text"
            value={form.building_size ?? ''}
            onChange={e => update('building_size', e.target.value)}
            placeholder='e.g. "30x40x12"'
          />
        </Field>
        <Field label="Building Type">
          <select value={form.building_type ?? ''} onChange={e => update('building_type', e.target.value)}>
            <option value="">— Select —</option>
            {BUILDING_TYPES.map(b => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Manufacturer">
          <select value={form.building_mfr ?? ''} onChange={e => update('building_mfr', e.target.value)}>
            <option value="">— Select —</option>
            {['CCI', 'CA', 'SBSI', 'MMM'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Estimated Price Range">
          <input
            type="text"
            value={form.estimated_price_range ?? ''}
            onChange={e => update('estimated_price_range', e.target.value)}
            placeholder='e.g. "$8k-$12k"'
          />
        </Field>
        <Field label="Features / Extras" wide>
          <textarea
            rows={2}
            value={form.building_features ?? ''}
            onChange={e => update('building_features', e.target.value)}
            placeholder="Roll-up doors, windows, insulation, walk-in doors, color preferences, etc."
          />
        </Field>
      </FormSection>

      <FormSection title="Address">
        {/* ZIP first — it auto-fills City / County / State; street goes last. */}
        <Field label="ZIP">
          <input type="text" inputMode="numeric" value={form.zip ?? ''} onChange={e => onZipChange(e.target.value)} placeholder="33401 — auto-fills city/county/state" />
          {(zipBusy || zipMsg) && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: zipMsg.startsWith('✓') ? 'var(--lime)' : 'var(--fg-3)' }}>
              {zipBusy ? 'Looking up…' : zipMsg}
            </span>
          )}
        </Field>
        <Field label="City">
          <input type="text" value={form.city ?? ''} onChange={e => update('city', e.target.value)} />
        </Field>
        <Field label="County">
          <input type="text" value={form.county ?? ''} onChange={e => update('county', e.target.value)} />
        </Field>
        <Field label="State">
          <input type="text" value={form.state ?? ''} onChange={e => update('state', e.target.value)} maxLength={2} placeholder="FL" />
        </Field>
        <Field label="Street" wide>
          <input type="text" value={form.address_line ?? ''} onChange={e => update('address_line', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Lead Details">
        <Field label="First Contact Date">
          <input
            type="date"
            value={form.first_contact_date ?? ''}
            onChange={e => update('first_contact_date', e.target.value)}
          />
        </Field>
        <Field label="Source">
          <select value={form.source ?? ''} onChange={e => update('source', e.target.value)}>
            <option value="">— Select —</option>
            {LEAD_SOURCES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Source Detail">
          <input type="text" value={form.source_detail ?? ''} onChange={e => update('source_detail', e.target.value)} placeholder="e.g. 'FB Memorial Day ad'" />
        </Field>
        <Field label="Sales Stage">
          <select value={form.status ?? 'new_lead'} onChange={e => update('status', e.target.value)}>
            {CLIENT_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
      </FormSection>

      {form.status === 'ordered' && (
        <FormSection title="Project Stage (Ordered)">
          <Field label="Project Stage">
            <select value={form.project_stage ?? 'ordered'} onChange={e => update('project_stage', e.target.value)}>
              {PROJECT_STAGES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Deposit Payment">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={!!form.payment_cleared}
                onChange={e => update('payment_cleared', e.target.checked)}
              />
              <span>Payment cleared (ACH / deposit received)</span>
            </label>
          </Field>
        </FormSection>
      )}

      <FormSection title="Assignment & Follow-Up">
        <Field label="Primary Rep *">
          <select value={form.primary_rep ?? ''} onChange={e => update('primary_rep', e.target.value)} required>
            <option value="">— Select —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{repOptionLabel(u)}</option>
            ))}
          </select>
        </Field>
        <Field label="Secondary Rep">
          <select value={form.secondary_rep ?? ''} onChange={e => update('secondary_rep', e.target.value)}>
            <option value="">— None —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{repOptionLabel(u)}</option>
            ))}
          </select>
        </Field>
        <Field label="Follow-Up Date">
          <input type="date" value={form.follow_up_date ?? ''} onChange={e => update('follow_up_date', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Notes">
        <Field wide>
          <textarea
            rows={5}
            value={form.notes ?? ''}
            onChange={e => update('notes', e.target.value)}
            placeholder="What we generally know about this client — preferences, history, anything that helps."
          />
        </Field>
      </FormSection>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={submitting}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function FormSection({ title, children }) {
  return (
    <div className="form-section">
      <div className="form-section-title">{title}</div>
      <div className="form-grid">{children}</div>
    </div>
  )
}

function Field({ label, children, wide }) {
  return (
    <label className={`form-field${wide ? ' form-field-wide' : ''}`}>
      {label && <span className="form-label">{label}</span>}
      {children}
    </label>
  )
}
