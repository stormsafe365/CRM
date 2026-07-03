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
import OrderModal from '../components/OrderModal'
import { fmtTime } from '../lib/followups'
import ActivityProgress from '../components/ActivityProgress'
import FollowUpsCard from '../components/FollowUpsCard'
import OrderTimeline from '../components/OrderTimeline'
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
  const [ordering, setOrdering] = useState(false) // "Mark as Ordered" → OrderModal

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

  // Lead temperature, set via the thermometer slider. Stamps who/when, and
  // drives the sales stage — sliding the bar moves the status to match (so it
  // shows on the Activity & Progress stepper and the Stage pill too).
  const TEMP_TO_STATUS = { cold: 'new_lead', warm: 'contacted', working: 'working', hot: 'working_hot', ready: 'quoted', pending_deposit: 'deposit_pending', ordered: 'ordered' }
  async function setTemperature(t) {
    const patch = {
      lead_temperature: t,
      lead_temp_updated_at: new Date().toISOString(),
      lead_temp_updated_by: user?.id ?? null,
    }
    const mapped = TEMP_TO_STATUS[t]
    if (mapped) {
      patch.status = mapped
      if (mapped === 'ordered') patch.project_stage = client.project_stage || 'ordered'
    }
    const { error } = await supabase.from('clients').update(patch).eq('id', id)
    if (error) {
      const m = (error.message || '').toLowerCase()
      toast(m.includes('lead_temperature') || m.includes('check constraint') || m.includes('violates')
        ? 'That temperature needs the one-time database update (migration 012) before it will save.'
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
    // Soft-delete — the lead is hidden everywhere but recoverable from Trash.
    const { error } = await supabase.from('clients')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq('id', id)
    if (error) {
      const m = (error.message || '').toLowerCase()
      setError(m.includes('deleted_at') || m.includes('column') || m.includes('schema cache')
        ? 'Recovery needs the one-time database update (migration 017) before deleting.'
        : error.message)
    } else navigate('/clients')
  }

  if (loading) return <div className="muted">Loading…</div>
  if (error) return <div className="error-banner">{error}</div>
  if (!client) return <div className="muted">Client not found.</div>

  if (editing) {
    return (
      <div style={{ padding: '24px 26px 48px', maxWidth: 920, margin: '0 auto' }}>
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

  const repName = userLabel(users, client.primary_rep)
  const repInitial = repName && repName !== '—' ? repName.trim()[0].toUpperCase() : '?'
  const mfr = client.building_mfr || client.order_mfr || (latestQuote?.manufacturer ? (MFR_LABEL[latestQuote.manufacturer] || latestQuote.manufacturer) : '—')
  const stroke = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>

  return (
    <div className="cp">
      {/* ===================== LEFT: Client Summary ===================== */}
      <aside className="cp-summary">
        <Link to="/clients" className="cp-back">{stroke(<path d="M19 12H5M12 19l-7-7 7-7" />)}Back to Leads</Link>

        <div className="cp-id">
          <div className="cp-avatar">{initials}</div>
          <div className="cp-name">
            <h2>{client.name}</h2>
            <span className="cp-edit" onClick={() => setEditing(true)} role="button" aria-label="Edit lead">
              {stroke(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>)}
            </span>
          </div>
          <div className="cp-statuspill"><StatusPill status={client.status} /></div>
        </div>

        <div className="cp-contact">
          {client.phone && <a className="cp-crow" href={`tel:${client.phone}`}>{stroke(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />)}<span>{client.phone}</span></a>}
          {client.email && <a className="cp-crow" href={`mailto:${client.email}`}>{stroke(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>)}<span className="ell">{client.email}</span></a>}
          {addr && <div className="cp-crow">{stroke(<><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>)}<span>{addr}</span></div>}
          {client.source && <div className="cp-source">Lead Source · <b>{sourceLabel(client.source)}</b></div>}
        </div>

        <div className="cp-block">
          <div className="cp-block-label">Project Spec</div>
          <div className="cp-spec">
            <div className="cp-spec-row"><span>Building Type</span><span className="v teal">{client.building_type ? buildingTypeLabel(client.building_type) : '—'}</span></div>
            <div className="cp-spec-row"><span>Building Size</span><span className="v num">{client.building_size || '—'}</span></div>
            <div className="cp-spec-row"><span>Manufacturer</span><span className="v">{mfr}</span></div>
            <div className="cp-spec-row"><span>Foundation</span><span className="v">{client.order_foundation || '—'}</span></div>
            <div className="cp-spec-row"><span>Current Quote</span><span className="v teal num">{fmtMoney(latestQuote?.total_amount) ?? '—'}</span></div>
          </div>
        </div>

        <div className="cp-block">
          <div className="cp-block-label">Pipeline Stage</div>
          {client.status === 'ordered' && client.project_stage && (
            <span className="status-pill" style={{ display: 'inline-flex', marginBottom: 12, background: projectStageColor(client.project_stage).bg, color: projectStageColor(client.project_stage).fg }}>
              {projectStageLabel(client.project_stage)}
            </span>
          )}
          <LeadTempSlider
            value={client.lead_temperature}
            updatedAt={client.lead_temp_updated_at}
            updatedByName={userLabel(users, client.lead_temp_updated_by)}
            onChange={setTemperature}
          />
        </div>

        <div className="cp-block">
          <div className="cp-block-label">Assigned Rep</div>
          <div className="cp-rep">
            <span className="cp-rep-av">{repInitial}</span>
            <b>{repName}</b>
            <span className="cp-rep-change" role="button" onClick={() => setEditing(true)}>Change</span>
          </div>
        </div>

        <div className="cp-block">
          {client.status === 'ordered' ? (
            <button className="order-btn ordered" onClick={() => setOrdering(true)} title="Edit order details">
              {stroke(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>)}Edit Order
            </button>
          ) : (
            <button className="order-btn" onClick={() => setOrdering(true)} title="Mark this lead as officially ordered">
              {stroke(<path d="M20 6 9 17l-5-5" />)}Mark as Ordered
            </button>
          )}
          <div className="cp-block-label" style={{ marginTop: 16 }}>Next Follow-Up</div>
          <div className="cp-nextfu">{stroke(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>)}{nextFollow}</div>
          <div className="chip-grid">
            <button className="chip" onClick={() => quickReschedule('today')}>Today</button>
            <button className="chip" onClick={() => quickReschedule('3d')}>+3 days</button>
            <button className="chip" onClick={() => quickReschedule('2w')}>+2 weeks</button>
            <button className="chip" onClick={() => quickReschedule('1m')}>+1 month</button>
            <button className="chip" onClick={() => setEditing(true)}>Custom…</button>
          </div>
          {'cooling_off' in client && (
            <div className="cadence-note" onClick={toggleCooling} role="button" title="Toggle cooling-off cadence"
              style={{ cursor: 'pointer', marginTop: 12, color: client.cooling_off ? 'var(--warning)' : 'var(--fg-3)' }}>
              {stroke(<><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" /><path d="M12 8v4l3 2" /></>)}
              {client.cooling_off ? 'Cooling off — longer cadence' : 'Standard cadence — click to cool off'}
            </div>
          )}
        </div>

        <button className="cp-delete" onClick={() => setConfirmingDelete(true)}>Delete Lead</button>
      </aside>

      {/* ===================== RIGHT: Work area ===================== */}
      <div className="cp-work">
        {confirmingDelete && (
          <div className="confirm-card">
            <div>
              <strong>Delete this lead?</strong>
              <div className="muted" style={{ marginTop: 4 }}>This permanently deletes the lead and all their quotes and activity history. Cannot be undone.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmingDelete(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} className="btn-danger">Yes, delete</button>
            </div>
          </div>
        )}

        {client.status === 'ordered' && (
          <PaymentToggle client={client} onChange={(val) => setClient({ ...client, payment_cleared: val })} />
        )}

        <ActivityProgress client={client} showAudience={client.status === 'ordered'} />

        {client.status === 'ordered' && <OrderTimeline client={client} />}

        <div className="row-2 quotes-docs">
          <QuotesTab clientId={client.id} client={client} clientBuildingSize={client.building_size}
            building={buildingQuote} setBuilding={setBuildingQuote} />
          <DocumentHub clientId={client.id} clientName={client.name} client={client} onBuildQuote={() => setBuildingQuote(true)} />
        </div>

        <div className="row-2">
          <NotesSection clientId={client.id} />
          <FollowUpsCard clientId={client.id} />
        </div>
      </div>

      {ordering && (
        <OrderModal client={client} onClose={() => setOrdering(false)} onSaved={(patch) => setClient(c => ({ ...c, ...patch }))} />
      )}
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
