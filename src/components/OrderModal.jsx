// OrderModal: marks a lead as officially ordered (contract signed + deposit
// placed) and captures what the Follow-Up HQ milestone engine needs —
// manufacturer, order date, Plans Required, install lead time, county,
// foundation, permitting, plus the Exempt + Site-ready toggles. Saving flips the
// lead to "ordered", clears the deposit, and stores the order. The calendar then
// seeds the milestone chain (the rest spawns as each milestone is checked off).

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { usd } from '../lib/money'
import { parseDepositAmount, DEPOSIT_METHODS } from '../lib/payments'
import { tableMissing } from '../lib/perfLoad'

const MFRS = ['CCI', 'CA', 'SBS']
// keys match the calendar engine's PLAN_TYPES
// earliest = when the Plan Status follow-up fires, measured from invoice paid
// (HQ Follow-Up Timeline spec: ~7-biz-day plans → 7 days · 2–3 wk → 2.5 weeks ·
// 4–6 wk → 4 weeks). Keep in sync with ssfuEngine.js PLAN_TYPES.
const PLANS = {
  none:            { label: 'None (no plans)' },
  masterfiles:     { label: 'Master files (~7 biz days)',   earliest: '+7 days' },
  generic:         { label: 'Generic plans (~2–3 wk)',      earliest: '+2.5 weeks' },
  generic_stamped: { label: 'Generic stamped plans (~2–3 wk)', earliest: '+2.5 weeks' },
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
function buildPreview(orderStr, planKey, bucketStr, county, exempt, siteReady, foundation, permitting) {
  if (!orderStr) return { dated: [], later: [] }
  const order = parseLocal(orderStr)
  const p = PLANS[planKey] || PLANS.generic
  const dated = [{ d: addBiz(order, 2), type: 'mfr', title: 'Order Confirmation' }]
  if (planKey !== 'none') {
    dated.push({ d: addBiz(order, 5), type: 'mfr', title: 'Plan Invoice Issued?' })
    dated.push({ d: addBiz(order, 7), type: 'pay', title: 'Confirm Invoice Paid', gate: true })
  }
  const later = []
  const cty = county ? ` (${county} County)` : ''
  const clientPermits = /client/i.test(permitting || '')
  later.push(planKey === 'none' ? 'No plans required → straight to permit / site' : `Plan Status — ${p.earliest || ''} after invoice paid`)
  later.push(exempt ? 'Permit — none (exempt)'
    : clientPermits ? `Permit — customer pulls their own${cty} · 3-wk check-in after plans`
    : `Permit — we handle it${cty} · 2.5 wk after plans`)
  later.push(siteReady ? 'Site ready — site-prep skipped' : `Site Prep${foundation ? ` (${foundation})` : ''} — 4-wk check-in after plans (client sends a photo when done)`)
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
  // Deposit received (owner 10/16/26: tracked for the Performance page; table 022)
  const [deps, setDeps] = useState(null) // null = loading · 'missing' = 022 not run · [] / rows
  const [depAmount, setDepAmount] = useState('')
  const [depDate, setDepDate] = useState('') // '' = the order date
  const [depMethod, setDepMethod] = useState('')
  useEffect(() => {
    let alive = true
    supabase.from('payments').select('id, amount, received_on, method').eq('client_id', client.id).is('deleted_at', null).order('received_on', { ascending: true })
      .then(({ data, error }) => { if (alive) setDeps(error ? (tableMissing(error) ? 'missing' : []) : data || []) })
    return () => { alive = false }
  }, [client.id])
  async function removeDeposit(d) {
    if (!window.confirm(`Remove the ${usd(d.amount)} deposit from ${d.received_on}?`)) return
    const { error } = await supabase.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', d.id)
    if (error) { setErr(`Could not remove the deposit: ${error.message}`); return }
    setDeps((list) => (Array.isArray(list) ? list.filter((x) => x.id !== d.id) : list))
  }

  const preview = useMemo(
    () => buildPreview(orderDate, plan, bucket, county.trim(), exempt, siteReady, foundation, exempt ? '' : permitting),
    [orderDate, plan, bucket, county, exempt, siteReady, foundation, permitting]
  )

  async function save() {
    if (!orderDate) { setErr('Pick an order date.'); return }
    const dep = depAmount.trim() ? parseDepositAmount(depAmount) : null
    if (depAmount.trim() && dep == null) { setErr('Deposit received: type the amount, e.g. 5100 or 5,100.50.'); return }
    const depOn = depDate || orderDate
    setSaving(true); setErr('')
    const patch = {
      status: 'ordered',
      payment_cleared: true,
      lead_temperature: 'ordered', // keep the summary temp bar in sync with the order
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
    if (error) {
      setSaving(false)
      const m = (error.message || '').toLowerCase()
      setErr(m.includes('order_') || m.includes('schema cache') || m.includes('column')
        ? 'This needs the one-time database update (migrations 013–015) before it will save.'
        : error.message)
      return
    }
    onSaved?.(patch)
    if (dep != null && Array.isArray(deps)) {
      const { data: row, error: e2 } = await supabase.from('payments')
        .insert({ client_id: client.id, kind: 'deposit', amount: dep, received_on: depOn, method: depMethod || null })
        .select('id, amount, received_on, method').single()
      setSaving(false)
      if (e2) { setErr(`The order is saved, but the deposit did not save: ${e2.message}. Try Save again.`); return }
      setDeps((list) => [...(Array.isArray(list) ? list : []), row])
      setDepAmount('')
    } else setSaving(false)
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

          <div className="fum-field">
            <span className="fum-label">Deposit received</span>
            {deps === null ? <div className="muted" style={{ fontSize: 12.5 }}>Loading deposits…</div>
              : deps === 'missing' ? <div className="muted" style={{ fontSize: 12.5 }}>Deposit tracking needs the one-time database update (022_payments.sql). The order still saves.</div>
              : (
                <>
                  {deps.length > 0 && (
                    <div className="dep-list">
                      {deps.map((d) => (
                        <div className="dep-row" key={d.id}>
                          <span className="num">{usd(d.amount)}</span>
                          <span className="muted">received {d.received_on}{d.method ? ` · ${d.method}` : ''}</span>
                          <button type="button" className="dep-x" onClick={() => removeDeposit(d)} aria-label={`Remove the ${usd(d.amount)} deposit`}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="fum-row3 dep-new">
                    <label className="fum-field">
                      <span className="fum-label">{deps.length ? 'Another deposit ($)' : 'Amount ($)'}</span>
                      <input type="text" inputMode="decimal" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder="e.g. 5100 (leave empty if none yet)" />
                    </label>
                    <label className="fum-field">
                      <span className="fum-label">Date received</span>
                      <input type="date" value={depDate || orderDate} onChange={(e) => setDepDate(e.target.value)} />
                    </label>
                    <label className="fum-field">
                      <span className="fum-label">Paid by</span>
                      <select value={depMethod} onChange={(e) => setDepMethod(e.target.value)}>
                        <option value="">— Select —</option>
                        {DEPOSIT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                  </div>
                </>
              )}
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
