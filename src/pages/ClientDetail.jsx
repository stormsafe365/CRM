// ClientDetail: view + edit a single lead.
// Top is a 4-panel Customer Summary (Customer · Project · Stage & Assigned ·
// Lead Temperature). Below: collapsible Activity & Progress, the quote deck,
// and the Document Hub. "Edit" (pencil) opens the full form.
// Live-updates via realtime so partner edits show without a refresh.

import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { statusLabel, sourceLabel, buildingTypeLabel, projectStageLabel, projectStageColor } from '../lib/constants'
import StatusPill from '../components/StatusPill'
import ClientForm from '../components/ClientForm'
import QuotesTab from '../components/QuotesTab'
import DocumentHub from '../components/DocumentHub'
import { fmtTime } from '../lib/followups'
import ActivityProgress from '../components/ActivityProgress'
import FollowUpsCard from '../components/FollowUpsCard'
import LeadTempSlider from '../components/LeadTempSlider'
import NotesSection from '../components/NotesSection'
import { useAuth } from '../context/AuthContext'

const MFR_LABEL = { ca: 'Carolina Carports', cci: 'CCI', other: 'Other' }

function fmtMoney(n) {
  if (n == null) return null
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatDate(yyyyMMdd) {
  if (!yyyyMMdd) return '—'
  const [y, m, d] = yyyyMMdd.split('-')
  return `${m}/${d}/${y}`
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { users } = useUsers()
  const { user } = useAuth()
  const [client, setClient] = useState(null)
  const [latestQuote, setLatestQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single()
      if (cancelled) return
      if (error) setError(error.message)
      else setClient(data)
      setLoading(false)
    }
    async function loadQuote() {
      // Latest quote drives the summary's Manufacturer + Current Quote.
      const { data } = await supabase
        .from('quotes')
        .select('total_amount, manufacturer, quote_number, status')
        .eq('client_id', id)
        .order('quote_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (!cancelled) setLatestQuote((data ?? [])[0] ?? null)
    }
    load()
    loadQuote()

    const channel = supabase
      .channel(`client-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes', filter: `client_id=eq.${id}` }, () => loadQuote())
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [id])

  async function handleUpdate(payload) {
    const { error } = await supabase.from('clients').update(payload).eq('id', id)
    if (error) throw error
    setEditing(false)
  }

  async function toggleCooling() {
    const next = !client.cooling_off
    const { error } = await supabase.from('clients').update({ cooling_off: next }).eq('id', id)
    if (!error) setClient(c => ({ ...c, cooling_off: next }))
  }

  // Lead temperature, set via the thermometer slider. Stamps who/when.
  async function setTemperature(t) {
    const patch = {
      lead_temperature: t,
      lead_temp_updated_at: new Date().toISOString(),
      lead_temp_updated_by: user?.id ?? null,
    }
    const { error } = await supabase.from('clients').update(patch).eq('id', id)
    if (!error) setClient(c => ({ ...c, ...patch }))
  }

  async function handleDelete() {
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) setError(error.message)
    else navigate('/clients')
  }

  if (loading) return <div className="muted">Loading…</div>
  if (error) return <div className="error-banner">{error}</div>
  if (!client) return <div className="muted">Client not found.</div>

  if (editing) {
    return (
      <div>
        <div className="page-header">
          <div>
            <Link to="/clients" className="back-link">← Back to Leads</Link>
            <h1>Edit Lead</h1>
          </div>
        </div>
        <ClientForm initial={client} onSubmit={handleUpdate} onCancel={() => setEditing(false)} submitLabel="Save Changes" />
      </div>
    )
  }

  const initials = (client.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const addr = [client.address_line, [client.city, client.state].filter(Boolean).join(', '), client.zip].filter(Boolean).join('  ·  ')
  const nextFollow = client.follow_up_date
    ? `${formatDate(client.follow_up_date)}${client.follow_up_time ? ` @ ${fmtTime(client.follow_up_time)}` : ''}`
    : '—'

  return (
    <div>
      <Link to="/clients" className="back-link">← Back to Leads</Link>

      {confirmingDelete && (
        <div className="confirm-card">
          <div>
            <strong>Delete this lead?</strong>
            <div className="muted" style={{ marginTop: 4 }}>
              This permanently deletes the lead and all their quotes and activity history. Cannot be undone.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleDelete} className="btn-danger">Yes, delete</button>
          </div>
        </div>
      )}

      {/* ===== Customer Summary — 4 panels ===== */}
      <div className="cust-summary stagger">
        {/* Customer */}
        <div className="cs-panel" style={{ '--i': 0 }}>
          <div className="cs-cust-head">
            <div className="cs-avatar">{initials}</div>
            <div className="cs-name-row">
              <h1 className="cs-name">{client.name}</h1>
              <button className="cs-edit" onClick={() => setEditing(true)} title="Edit lead" aria-label="Edit lead">✎</button>
            </div>
          </div>
          <div className="cs-lines">
            {client.phone && <div className="cs-line">📞 {client.phone}</div>}
            {client.email && <div className="cs-line">✉️ {client.email}</div>}
            {addr && <div className="cs-line">📍 {addr}</div>}
          </div>
          {client.source && <span className="cs-source">Lead Source: {sourceLabel(client.source)}</span>}
        </div>

        {/* Project */}
        <div className="cs-panel" style={{ '--i': 1 }}>
          <div className="cs-eyebrow">Project</div>
          <div className="cs-headline">{client.building_size || '—'}</div>
          <div className="cs-kv"><span>Building Type</span><b>{client.building_type ? buildingTypeLabel(client.building_type) : '—'}</b></div>
          <div className="cs-kv"><span>Manufacturer</span><b>{latestQuote?.manufacturer ? (MFR_LABEL[latestQuote.manufacturer] || latestQuote.manufacturer) : '—'}</b></div>
          <div className="cs-kv"><span>Current Quote</span><b className="cs-quote">{fmtMoney(latestQuote?.total_amount) ?? '—'}</b></div>
        </div>

        {/* Stage & Assigned */}
        <div className="cs-panel" style={{ '--i': 2 }}>
          <div className="cs-eyebrow">Stage &amp; Assigned</div>
          <div className="cs-pills">
            <StatusPill status={client.status} />
            {client.status === 'ordered' && client.project_stage && (
              <span className="status-pill" style={{ background: projectStageColor(client.project_stage).bg, color: projectStageColor(client.project_stage).fg }}>
                {projectStageLabel(client.project_stage)}
              </span>
            )}
          </div>
          <div className="cs-kv"><span>Assigned Rep</span><b>{userLabel(users, client.primary_rep)}</b></div>
          <div className="cs-kv"><span>Next Follow-Up</span><b>{nextFollow}</b></div>
          {'cooling_off' in client && (
            <label className="cooling-toggle" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={!!client.cooling_off} onChange={toggleCooling} />
              <span>Cooling off — longer cadence</span>
            </label>
          )}
        </div>

        {/* Lead Temperature */}
        <div className="cs-panel" style={{ '--i': 3 }}>
          <div className="cs-eyebrow">Lead Temperature</div>
          <LeadTempSlider
            value={client.lead_temperature}
            updatedAt={client.lead_temp_updated_at}
            updatedByName={userLabel(users, client.lead_temp_updated_by)}
            onChange={setTemperature}
          />
        </div>
      </div>

      <div className="cs-actions">
        <button onClick={() => setConfirmingDelete(true)} className="btn-danger-ghost">Delete lead</button>
      </div>

      {client.status === 'ordered' && (
        <PaymentToggle client={client} onChange={(val) => setClient({ ...client, payment_cleared: val })} />
      )}

      <div className="ap-row">
        <ActivityProgress client={client} showAudience={client.status === 'ordered'} />
        <FollowUpsCard clientId={client.id} />
      </div>

      <div className="detail-card detail-card-full" style={{ marginTop: 16 }}>
        <QuotesTab clientId={client.id} client={client} clientBuildingSize={client.building_size} />
      </div>

      <DocumentHub clientId={client.id} />

      <NotesSection clientId={client.id} />
    </div>
  )
}

function PaymentToggle({ client, onChange }) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const cleared = !!client.payment_cleared

  async function toggle() {
    const next = !cleared
    setSaving(true); setErr('')
    const { error } = await supabase.from('clients').update({ payment_cleared: next }).eq('id', client.id)
    setSaving(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      setErr(m.includes('payment_cleared') || m.includes('schema cache')
        ? 'This needs the one-time payment database update before it will save.'
        : error.message)
      return
    }
    onChange(next)
  }

  return (
    <div className={`pay-bar ${cleared ? 'cleared' : 'pending'}`}>
      <label className="pay-check">
        <input type="checkbox" checked={cleared} onChange={toggle} disabled={saving} />
        <span>Deposit / ACH payment cleared</span>
      </label>
      <span className={`pay-badge ${cleared ? 'ok' : 'warn'}`}>
        {cleared ? '✓ Payment cleared' : '⏳ Payment pending'}
      </span>
      {err && <span className="pay-err">{err}</span>}
    </div>
  )
}
