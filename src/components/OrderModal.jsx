// OrderModal: marks a lead as officially ordered (contract signed + deposit
// placed) and captures the four scheduling inputs the Follow-Up HQ needs —
// manufacturer, order date, engineered-plan type, install lead time — plus the
// permitting county. Saving flips the lead to "ordered", clears the deposit,
// and stores the order details on the client. From there the CRM bridge pushes
// them to the calendar, which auto-builds the full follow-up timeline.
//
// The preview below mirrors the calendar's auto-scheduler so the rep sees the
// exact sequence they're setting up before they save.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

const MFRS = ['CCI', 'CA', 'SBS']
const PLANS = {
  generic: { label: 'Generic stamped plans (~2–3 wk)', engWeeks: 3, blurb: 'Generic stamped plans run ~2–3 wks.' },
  site:    { label: 'Site-specific plans (~4–5 wk)',    engWeeks: 4, blurb: 'Site-specific plans run ~4–5 wks.' },
  asbuilt: { label: 'As-built stamped plans (~4–5 wk)', engWeeks: 4, blurb: 'As-built stamped plans run ~4–5 wks.' },
}
const BUCKETS = ['4-6', '6-8', '8-10', '10-12', '12-14']

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const parseLocal = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d }
const addWeeks = (date, n) => addDays(date, n * 7)
const addBiz = (date, n) => { let d = new Date(date), a = 0; while (a < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) a++ } return d }
const maxD = (a, b) => (a.getTime() > b.getTime() ? a : b)
const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Same sequence the calendar builds — kept in lockstep with buildOrderFollowups.
function buildPreview(orderStr, planKey, bucketStr, county) {
  if (!orderStr) return []
  const order = parseLocal(orderStr)
  const plan = PLANS[planKey] || PLANS.generic
  const [lo, hi] = bucketStr.split('-').map(Number)
  const installStart = addWeeks(order, lo), installEnd = addWeeks(order, hi)
  const cty = county ? ` (${county} County)` : ''
  const t = [
    { d: addBiz(order, 2), type: 'mfr', title: 'Confirm manufacturer received order' },
    { d: addBiz(order, 7), type: 'mfr', title: 'Invoice-for-plans follow-up' },
    { d: addWeeks(order, plan.engWeeks), type: 'mfr', title: 'Engineered plans follow-up' },
    { d: addWeeks(order, 6), type: 'mfr', title: `Permitting follow-up #1${cty}` },
    { d: addWeeks(order, 8), type: 'mfr', title: 'Permitting follow-up #2' },
    { d: addWeeks(order, 8), type: 'client', title: 'Site-prep check-in' },
    { d: maxD(addWeeks(order, 8), addDays(installStart, -7)), type: 'mfr', est: true, title: 'Scheduling confirmation' },
    { d: addDays(installStart, -3), type: 'client', est: true, title: 'Installation check-in' },
    { d: installStart, type: 'install', est: true, title: `Installation (${fmt(installStart)} – ${fmt(installEnd)})` },
  ]
  return t.sort((a, b) => a.d - b.d)
}

export default function OrderModal({ client, onClose, onSaved }) {
  const [mfr, setMfr] = useState(client.order_mfr || 'CCI')
  const [orderDate, setOrderDate] = useState(client.order_date || isoToday())
  const [plan, setPlan] = useState(client.order_plan || 'generic')
  const [bucket, setBucket] = useState(client.order_bucket || '8-10')
  const [county, setCounty] = useState(client.county || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const preview = useMemo(() => buildPreview(orderDate, plan, bucket, county.trim()), [orderDate, plan, bucket, county])

  async function save() {
    if (!orderDate) { setErr('Pick an order date.'); return }
    setSaving(true); setErr('')
    const patch = {
      status: 'ordered',
      payment_cleared: true,
      order_date: orderDate,
      order_mfr: mfr,
      order_plan: plan,
      order_bucket: bucket,
      county: county.trim() || client.county || null,
    }
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
    setSaving(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      setErr(m.includes('order_') || m.includes('schema cache') || m.includes('column')
        ? 'This needs the one-time database update (migration 013) before it will save.'
        : error.message)
      return
    }
    onSaved?.(patch)
    onClose()
  }

  return createPortal(
    <div className="fum-overlay" role="dialog" aria-modal="true" aria-label="Mark as ordered" onClick={onClose}>
      <div className="fum" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="fum-head">
          <h3>Mark as Ordered — {client.name}</h3>
          <button className="fum-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="fum-body">
          <div className="muted" style={{ marginTop: -4, marginBottom: 4, fontSize: 13 }}>
            Contract signed &amp; deposit placed. These details build the follow-up timeline in Follow-Up HQ.
          </div>

          <div className="fum-row2">
            <label className="fum-field">
              <span className="fum-label">Manufacturer</span>
              <select value={mfr} onChange={e => setMfr(e.target.value)}>
                {MFRS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="fum-field">
              <span className="fum-label">Order Date</span>
              <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </label>
          </div>

          <label className="fum-field">
            <span className="fum-label">Engineered Plan Type</span>
            <select value={plan} onChange={e => setPlan(e.target.value)}>
              {Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </label>

          <div className="fum-row2">
            <label className="fum-field">
              <span className="fum-label">Install Lead Time</span>
              <select value={bucket} onChange={e => setBucket(e.target.value)}>
                {BUCKETS.map(b => <option key={b} value={b}>{b} weeks</option>)}
              </select>
            </label>
            <label className="fum-field">
              <span className="fum-label">County (permitting)</span>
              <input type="text" value={county} onChange={e => setCounty(e.target.value)} placeholder="e.g. Palm Beach" />
            </label>
          </div>

          {preview.length > 0 && (
            <div className="fum-field">
              <span className="fum-label">Timeline preview · {preview.length} follow-ups</span>
              <div className="order-preview">
                {preview.map((t, i) => (
                  <div className="op-row" key={i}>
                    <span className={`op-dot ${t.type}`} />
                    <span className="op-date num">{fmt(t.d)}</span>
                    <span className="op-title">{t.title}{t.est && <span className="op-est">EST</span>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && <div className="fum-err">{err}</div>}
        </div>

        <div className="fum-foot">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : '✓ Confirm Order'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
