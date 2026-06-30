// OrderModal: marks a lead as officially ordered (contract signed + deposit
// placed) and captures what the Follow-Up HQ milestone engine needs —
// manufacturer, order date, Plans Required, install lead time, county,
// foundation, permitting, plus the Exempt + Site-ready toggles. Saving flips the
// lead to "ordered", clears the deposit, and stores the order. The calendar then
// seeds the milestone chain (the rest spawns as each milestone is checked off).

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

const MFRS = ['CCI', 'CA', 'SBS']
// keys match the calendar engine's PLAN_TYPES
const PLANS = {
  none:            { label: 'None (no plans)' },
  masterfiles:     { label: 'Master files (~5–7 biz days)', earliest: '+5 biz days' },
  generic:         { label: 'Generic plans (~2–3 wk)',      earliest: '+2 weeks' },
  generic_stamped: { label: 'Generic stamped plans (~2–3 wk)', earliest: '+2 weeks' },
  sitespecific:    { label: 'Site-specific plans (~4–6 wk)', earliest: '+4 weeks' },
  asbuilt:         { label: 'As-built stamped plans (~4–6 wk)', earliest: '+4 weeks' },
}
const BUCKETS = ['4-6', '6-8', '8-10', '10-12', '12-14']
const FOUNDATIONS = ['Concrete', 'Gravel', 'Asphalt', 'Footers Only', 'Ground Install']
const PERMITTING = ['Client pulling permit', 'Permit service for building', 'Permit service for building & pad', 'No permit needed']

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const parseLocal = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addBiz = (date, n) => { let d = new Date(date), a = 0; while (a < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) a++ } return d }
const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Wave 0 (dated now) + a plain-English list of what spawns as milestones clear.
function buildPreview(orderStr, planKey, bucketStr, county, exempt, siteReady, foundation) {
  if (!orderStr) return { dated: [], later: [] }
  const order = parseLocal(orderStr)
  const p = PLANS[planKey] || PLANS.generic
  const dated = [{ d: addBiz(order, 2), type: 'mfr', title: 'Order Confirmation' }]
  if (planKey !== 'none') {
    dated.push({ d: addBiz(order, 5), type: 'mfr', title: 'Plan Invoice Issued?' })
    dated.push({ d: addBiz(order, 7), type: 'pay', title: 'Confirm Invoice Paid', gate: true })
  }
  const later = []
  later.push(planKey === 'none' ? 'No plans required → straight to permit / site' : `Plan Status — ${p.earliest || ''} after invoice paid`)
  later.push(exempt ? 'Permit — none (exempt)' : `Permit — after plans${county ? ` (${county} County)` : ''}, repeat every 14 days`)
  later.push(siteReady ? 'Site ready — site-prep skipped' : `Site Prep${foundation ? ` (${foundation})` : ''} — after plans`)
  later.push(`Scheduling → Installation (${bucketStr} wk lead) → Progress → Completion — once permit & site clear`)
  return { dated, later }
}

export default function OrderModal({ client, onClose, onSaved }) {
  const [mfr, setMfr] = useState(client.order_mfr || 'CCI')
  const [orderDate, setOrderDate] = useState(client.order_date || isoToday())
  const [plan, setPlan] = useState(client.order_plan === 'site' ? 'sitespecific' : (client.order_plan || 'generic'))
  const [bucket, setBucket] = useState(client.order_bucket || '8-10')
  const [county, setCounty] = useState(client.county || '')
  const [foundation, setFoundation] = useState(client.order_foundation || '')
  const [permitting, setPermitting] = useState(client.order_permitting || '')
  const [exempt, setExempt] = useState(!!client.order_exempt)
  const [siteReady, setSiteReady] = useState(!!client.order_site_ready)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const editing = client.status === 'ordered' || !!client.order_date

  const preview = useMemo(
    () => buildPreview(orderDate, plan, bucket, county.trim(), exempt, siteReady, foundation),
    [orderDate, plan, bucket, county, exempt, siteReady, foundation]
  )

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
      order_foundation: foundation || null,
      order_permitting: exempt ? 'No permit needed' : (permitting || null),
      order_exempt: exempt,
      order_site_ready: siteReady,
      county: county.trim() || client.county || null,
    }
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
    setSaving(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      setErr(m.includes('order_') || m.includes('schema cache') || m.includes('column')
        ? 'This needs the one-time database update (migrations 013–015) before it will save.'
        : error.message)
      return
    }
    onSaved?.(patch)
    onClose()
  }

  return createPortal(
    <div className="fum-overlay" role="dialog" aria-modal="true" aria-label={editing ? 'Edit order' : 'Mark as ordered'} onClick={onClose}>
      <div className="fum" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="fum-head">
          <h3>{editing ? 'Edit Order' : 'Mark as Ordered'} — {client.name}</h3>
          <button className="fum-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="fum-body">
          <div className="muted" style={{ marginTop: -4, marginBottom: 4, fontSize: 13 }}>
            {editing
              ? 'Update any detail and save — the Follow-Up HQ timeline rebuilds to match.'
              : 'Contract signed & deposit placed. These details seed the follow-up timeline in Follow-Up HQ.'}
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
            <span className="fum-label">Plans Required</span>
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

          <div className="fum-row2">
            <label className="fum-field">
              <span className="fum-label">Foundation Type</span>
              <select value={foundation} onChange={e => setFoundation(e.target.value)}>
                <option value="">— Select —</option>
                {FOUNDATIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="fum-field">
              <span className="fum-label">Permitting</span>
              <select value={permitting} onChange={e => setPermitting(e.target.value)} disabled={exempt}>
                <option value="">— Select —</option>
                {PERMITTING.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          <div className="fum-row2">
            <label className="fum-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <input type="checkbox" checked={exempt} onChange={e => setExempt(e.target.checked)} />
              <span className="fum-label" style={{ margin: 0 }}>Permit-exempt (e.g. ag) — no permit follow-ups</span>
            </label>
            <label className="fum-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <input type="checkbox" checked={siteReady} onChange={e => setSiteReady(e.target.checked)} />
              <span className="fum-label" style={{ margin: 0 }}>Site ready now — skip site-prep</span>
            </label>
          </div>

          {preview.dated.length > 0 && (
            <div className="fum-field">
              <span className="fum-label">Generated now</span>
              <div className="order-preview">
                {preview.dated.map((t, i) => (
                  <div className="op-row" key={i}>
                    <span className={`op-dot ${t.type}`} />
                    <span className="op-date num">{fmt(t.d)}</span>
                    <span className="op-title">{t.title}{t.gate && <span className="op-est">MILESTONE</span>}</span>
                  </div>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
                Then, as you check each milestone off in Follow-Up HQ:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {preview.later.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            </div>
          )}

          {err && <div className="fum-err">{err}</div>}
        </div>

        <div className="fum-foot">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : '✓ Confirm Order'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
