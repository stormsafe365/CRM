// QuoteForm: add / edit a single quote. Used inside QuotesTab.
// Fields: date, number, manufacturer, building size, status,
// total / deposit / balance, notes, and an optional PDF upload.

import { useState } from 'react'
import { uploadQuotePdf } from '../lib/storage'
import { QUOTE_STATUSES } from '../lib/constants'

const MFRS = [
  { value: '',    label: '— Select —' },
  { value: 'ca',  label: 'CA (Carports Anywhere)' },
  { value: 'cci', label: 'CCI (Carolina Carports)' },
]

const EMPTY = {
  quote_date: '', quote_number: '', manufacturer: '',
  building_size: '', status: 'draft',
  total_amount: '', deposit_amount: '', balance_amount: '',
  notes: '',
}

export default function QuoteForm({ clientId, initial, onSubmit, onCancel, submitLabel = 'Add Quote', defaultBuildingSize }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    ...EMPTY,
    quote_date: today,
    building_size: defaultBuildingSize || '',
    ...(initial ?? {}),
  })
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-fill balance = total − deposit when the user hasn't typed one.
  function onMoney(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }
      const total = parseFloat(field === 'total_amount' ? value : f.total_amount)
      const dep = parseFloat(field === 'deposit_amount' ? value : f.deposit_amount)
      if (!isNaN(total) && !isNaN(dep)) next.balance_amount = String(Math.max(0, total - dep))
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const payload = {}
      for (const [k, v] of Object.entries(form)) {
        if (['total_amount', 'deposit_amount', 'balance_amount'].includes(k)) {
          payload[k] = v === '' || v == null ? null : Number(v)
        } else {
          payload[k] = typeof v === 'string' && v.trim() === '' ? null : v
        }
      }
      if (file) {
        payload.pdf_snapshot_url = await uploadQuotePdf(clientId, file)
      }
      await onSubmit(payload)
    } catch (err) {
      setError(err.message || 'Could not save the quote.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="quote-form">
      <div className="form-grid">
        <label className="form-field">
          <span className="form-label">Quote Date</span>
          <input type="date" value={form.quote_date ?? ''} onChange={e => update('quote_date', e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Quote # (optional)</span>
          <input type="text" value={form.quote_number ?? ''} onChange={e => update('quote_number', e.target.value)} placeholder="SS-2026-…" />
        </label>
        <label className="form-field">
          <span className="form-label">Manufacturer</span>
          <select value={form.manufacturer ?? ''} onChange={e => update('manufacturer', e.target.value)}>
            {MFRS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Building Size</span>
          <input type="text" value={form.building_size ?? ''} onChange={e => update('building_size', e.target.value)} placeholder='e.g. "30x40x12"' />
        </label>
        <label className="form-field">
          <span className="form-label">Status</span>
          <select value={form.status ?? 'draft'} onChange={e => update('status', e.target.value)}>
            {QUOTE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Total Amount</span>
          <input type="number" min="0" step="1" value={form.total_amount ?? ''} onChange={e => onMoney('total_amount', e.target.value)} placeholder="$" />
        </label>
        <label className="form-field">
          <span className="form-label">Deposit</span>
          <input type="number" min="0" step="1" value={form.deposit_amount ?? ''} onChange={e => onMoney('deposit_amount', e.target.value)} placeholder="$" />
        </label>
        <label className="form-field">
          <span className="form-label">Balance</span>
          <input type="number" min="0" step="1" value={form.balance_amount ?? ''} onChange={e => update('balance_amount', e.target.value)} placeholder="$" />
        </label>
        <label className="form-field form-field-wide">
          <span className="form-label">Notes (e.g. revision note)</span>
          <input type="text" value={form.notes ?? ''} onChange={e => update('notes', e.target.value)} placeholder='e.g. "Bumped eave height +2′"' />
        </label>
        <label className="form-field form-field-wide">
          <span className="form-label">Quote PDF (optional)</span>
          <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary" disabled={submitting}>Cancel</button>}
        <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
