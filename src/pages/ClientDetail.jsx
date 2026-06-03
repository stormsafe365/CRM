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
import { toast } from '../lib/uiFx'

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
  const [buildingQuote, setBuildingQuote] = useState(false) // "Build Quote" — shared by QuotesTab + Document Hub menu

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
    if (error) {
      const m = (error.message || '').toLowerCase()
      toast(m.includes('lead_temperature') || m.includes('check constraint') || m.includes('violates')
        ? 'That temperature needs the one-time database update (migration 011) before it will save.'
        : error.message)
      return
    }
    setClient(c => ({ ...c, ...patch }))
  }

  // Quick-reschedule chips on the lead header — bump the legacy Next Follow-Up date.
  async function quickReschedule(kind) {
    const d = new Date()
    if (kind === '3d') d.setDate(d.getDate() + 3)
    else if (kind === '2w') d.setDate(d.getDate() + 14)
    else if (kind === '1m') d.setMonth(d.getMonth() + 1)
    else if (kind === '6w') d.setDate(d.getDate() + 42)
    else if (kind === 'snooze') d.setDate(d.getDate() + 7)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const { error } = await supabase.from('clients').update({ follow_up_date: iso }).eq('id', id)
    if (!error) setClient(c => ({ ...c, follow_up_date: iso }))
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
    <>
      <Link to="/clients" className="back-link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Back to Leads
      </Link>

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

      {/* ===== Lead Header — 4-column card ===== */}
      <section className="card lead-head">
        {/* identity */}
        <div className="identity">
          <div className="identity-top">
            <div className="avatar lg">{initials}</div>
            <div style={{ flex: 1 }}>
              <div className="id-name">
                <h2>{client.name}</h2>
                <svg className="id-edit" onClick={() => setEditing(true)} role="button" aria-label="Edit lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
              </div>
              {client.phone && (
                <a className="id-row link" href={`tel:${client.phone}`} style={{ textDecoration: 'none' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>{client.phone}
                </a>
              )}
              {client.email && (
                <a className="id-row link" href={`mailto:${client.email}`} style={{ textDecoration: 'none' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>{client.email}
                </a>
              )}
              {addr && (
                <div className="id-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>{addr}
                </div>
              )}
            </div>
          </div>
          {client.source && <span className="tag">Lead Source: <b>{sourceLabel(client.source)}</b></span>}
        </div>

        {/* project */}
        <div>
          <div className="col-label">Project</div>
          <div className="spec-list">
            <div className="spec-row"><span className="k">Building Type</span><span className="v">{client.building_type ? buildingTypeLabel(client.building_type) : '—'}</span></div>
            <div className="spec-row"><span className="k">Building Size</span><span className="v num">{client.building_size || '—'}</span></div>
            {client.roof_style && <div className="spec-row"><span className="k">Roof Style</span><span className="v">{client.roof_style}</span></div>}
            <div className="spec-row"><span className="k">Manufacturer</span><span className="v">{latestQuote?.manufacturer ? (MFR_LABEL[latestQuote.manufacturer] || latestQuote.manufacturer) : '—'}</span></div>
            <div className="spec-row"><span className="k">Current Quote</span><span className="v price num">{fmtMoney(latestQuote?.total_amount) ?? '—'}</span></div>
          </div>
        </div>

        {/* stage & assigned */}
        <div>
          <div className="col-label">Stage &amp; Assigned</div>
          <div className="cs-pills" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusPill status={client.status} />
            {client.status === 'ordered' && client.project_stage && (
              <span className="status-pill" style={{ background: projectStageColor(client.project_stage).bg, color: projectStageColor(client.project_stage).fg }}>
                {projectStageLabel(client.project_stage)}
              </span>
            )}
          </div>
          <div className="assigned-row" style={{ marginTop: 18 }}><span className="muted-label">Assigned Rep</span></div>
          <div className="assigned-row" style={{ marginTop: 6 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <b>{userLabel(users, client.primary_rep)}</b>
          </div>
          <div style={{ marginTop: 18 }}><span className="muted-label">Next Follow-Up</span></div>
          <div className="followup-time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>{nextFollow}
          </div>
          <div className="chip-grid">
            <button className="chip" onClick={() => quickReschedule('today')}>Today</button>
            <button className="chip" onClick={() => quickReschedule('3d')}>+3 days</button>
            <button className="chip" onClick={() => quickReschedule('2w')}>+2 weeks</button>
            <button className="chip" onClick={() => quickReschedule('1m')}>+1 month</button>
            <button className="chip" onClick={() => quickReschedule('6w')}>+6 weeks</button>
            <button className="chip snooze" onClick={() => quickReschedule('snooze')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>Snooze 1 wk
            </button>
            <button className="chip" onClick={() => setEditing(true)}>Custom…</button>
          </div>
          {'cooling_off' in client && (
            <div className="cadence-note" onClick={toggleCooling} role="button" title="Toggle cooling-off cadence"
              style={{ cursor: 'pointer', color: client.cooling_off ? 'var(--warning)' : 'var(--fg-3)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" /><path d="M12 8v4l3 2" /></svg>
              {client.cooling_off ? 'Cooling off — longer cadence' : 'Standard cadence — click to cool off'}
            </div>
          )}
        </div>

        {/* lead temperature */}
        <div>
          <div className="col-label">Lead Temperature</div>
          <LeadTempSlider
            value={client.lead_temperature}
            updatedAt={client.lead_temp_updated_at}
            updatedByName={userLabel(users, client.lead_temp_updated_by)}
            onChange={setTemperature}
          />
          <svg className="temp-edit" onClick={() => setEditing(true)} role="button" aria-label="Edit lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
        </div>

        <span className="delete-lead" onClick={() => setConfirmingDelete(true)} role="button">Delete Lead</span>
      </section>

      {client.status === 'ordered' && (
        <PaymentToggle client={client} onChange={(val) => setClient({ ...client, payment_cleared: val })} />
      )}

      <div className="row-2">
        <ActivityProgress client={client} showAudience={client.status === 'ordered'} />
        <FollowUpsCard clientId={client.id} />
      </div>

      <div className="row-2 flip">
        <QuotesTab clientId={client.id} client={client} clientBuildingSize={client.building_size}
          building={buildingQuote} setBuilding={setBuildingQuote} />
        <DocumentHub clientId={client.id} clientName={client.name} client={client} onBuildQuote={() => setBuildingQuote(true)} />
      </div>

      <NotesSection clientId={client.id} />
    </>
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
