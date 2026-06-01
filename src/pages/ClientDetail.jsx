// ClientDetail: view + edit a single client.
// "Edit" toggles the overview into a form.
// Live-updates via realtime so if your partner edits this same client,
// you see the change.

import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { statusLabel, sourceLabel, buildingTypeLabel, projectStageLabel, projectStageColor } from '../lib/constants'
import StatusPill from '../components/StatusPill'
import ClientForm from '../components/ClientForm'
import QuotesTab from '../components/QuotesTab'
import DocumentHub from '../components/DocumentHub'

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { users } = useUsers()
  const [client, setClient] = useState(null)
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
    load()

    const channel = supabase
      .channel(`client-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'clients', filter: `id=eq.${id}` },
        () => load()
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [id])

  async function handleUpdate(payload) {
    const { error } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', id)
    if (error) throw error
    setEditing(false)
  }

  async function handleDelete() {
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id)
    if (error) {
      setError(error.message)
    } else {
      navigate('/clients')
    }
  }

  if (loading) return <div className="muted">Loading…</div>
  if (error) return <div className="error-banner">{error}</div>
  if (!client) return <div className="muted">Client not found.</div>

  if (editing) {
    return (
      <div>
        <div className="page-header">
          <div>
            <Link to="/clients" className="back-link">← Clients</Link>
            <h1>Edit Client</h1>
          </div>
        </div>
        <ClientForm
          initial={client}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          submitLabel="Save Changes"
        />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/clients" className="back-link">← Clients</Link>
          <div className="detail-title-row">
            <h1>{client.name}</h1>
            <StatusPill status={client.status} />
            {client.status === 'ordered' && client.project_stage && (
              <span
                className="status-pill"
                style={{
                  background: projectStageColor(client.project_stage).bg,
                  color: projectStageColor(client.project_stage).fg,
                }}
              >
                {projectStageLabel(client.project_stage)}
              </span>
            )}
          </div>
        </div>
        <div className="header-actions">
          <button onClick={() => setEditing(true)} className="btn-secondary">Edit</button>
          <button onClick={() => setConfirmingDelete(true)} className="btn-danger-ghost">Delete</button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="confirm-card">
          <div>
            <strong>Delete this client?</strong>
            <div className="muted" style={{marginTop: 4}}>
              This permanently deletes the client and all their quotes and activity history. Cannot be undone.
            </div>
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <button onClick={() => setConfirmingDelete(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleDelete} className="btn-danger">Yes, delete</button>
          </div>
        </div>
      )}

      {client.status === 'ordered' && (
        <PaymentToggle
          client={client}
          onChange={(val) => setClient({ ...client, payment_cleared: val })}
        />
      )}

      <div className="detail-grid">
        <DetailCard title="Contact">
          <DetailRow label="Phone" value={client.phone} />
          <DetailRow label="Email" value={client.email} />
        </DetailCard>

        <DetailCard title="Building Inquiry">
          <DetailRow label="Building Size" value={client.building_size} />
          <DetailRow label="Building Type" value={client.building_type ? buildingTypeLabel(client.building_type) : null} />
          <DetailRow label="Est. Price Range" value={client.estimated_price_range} />
          {client.building_features && (
            <DetailRow label="Features" value={client.building_features} />
          )}
        </DetailCard>

        <DetailCard title="Address">
          <DetailRow label="Street" value={client.address_line} />
          <DetailRow label="City" value={client.city} />
          <DetailRow label="County" value={client.county} />
          <DetailRow label="State / ZIP" value={[client.state, client.zip].filter(Boolean).join(' ')} />
        </DetailCard>

        <DetailCard title="Lead">
          <DetailRow label="First Contact" value={client.first_contact_date ? formatDate(client.first_contact_date) : null} />
          <DetailRow label="Source" value={client.source ? sourceLabel(client.source) : null} />
          <DetailRow label="Source Detail" value={client.source_detail} />
          <DetailRow label="Sales Stage" value={statusLabel(client.status)} />
          {client.status === 'ordered' && (
            <DetailRow label="Project Stage" value={projectStageLabel(client.project_stage || 'ordered')} />
          )}
        </DetailCard>

        <DetailCard title="Assignment & Follow-Up">
          <DetailRow label="Primary Rep" value={userLabel(users, client.primary_rep)} />
          <DetailRow label="Secondary Rep" value={client.secondary_rep ? userLabel(users, client.secondary_rep) : null} />
          <DetailRow label="Follow-Up Date" value={client.follow_up_date ? formatDate(client.follow_up_date) : null} />
        </DetailCard>
      </div>

      {client.notes && (
        <div className="detail-card detail-card-full">
          <div className="detail-card-title">Notes</div>
          <div className="notes-body">{client.notes}</div>
        </div>
      )}

      <div className="detail-card detail-card-full" style={{marginTop: 16}}>
        <QuotesTab
          clientId={client.id}
          client={client}
          clientBuildingSize={client.building_size}
        />
      </div>

      <DocumentHub clientId={client.id} />

      <div className="placeholder-card">
        <div className="detail-card-title">Activity</div>
        <p className="muted">Activity timeline (notes, status changes, quote events) will appear here in the next build step.</p>
      </div>
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
    const { error } = await supabase
      .from('clients')
      .update({ payment_cleared: next })
      .eq('id', client.id)
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

function DetailCard({ title, children }) {
  return (
    <div className="detail-card">
      <div className="detail-card-title">{title}</div>
      <div className="detail-card-body">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">
        {value ?? <span className="muted">—</span>}
      </span>
    </div>
  )
}

function formatDate(yyyyMMdd) {
  const [y, m, d] = yyyyMMdd.split('-')
  return `${m}/${d}/${y}`
}
