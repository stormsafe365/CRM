// UnassignedDesigns: customer designs sent from a design link that was not made
// from a lead (the 3D Builder tab / New Quote → SEND DESIGN LINK → "No lead
// yet"). A strip on the Leads page while any are waiting; Review opens them
// with Attach to a lead (matching leads first: same phone / email / name),
// Make a new lead, or Remove. Hidden when there are none (or before migration 020).

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/uiFx'
import { isoToday } from '../lib/followups'
import { findDuplicateClients, dupSummary } from '../lib/dupCheck'
import { loadUnassignedDesigns, attachDesign, markDesign, matchLeads, escHtml } from '../lib/designLinks'
import { DesignItem } from './CustomerDesignsCard'
import { useLeadSearch } from '../lib/useLeadSearch'

const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5,
}
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }
const SMALL = { padding: '4px 10px', fontSize: 12.5 }

function AttachPicker({ design, onPick, onCancel, busy }) {
  const [q, setQ] = useState('')
  // newest 1,000 leads (never Trash) + the server's name / email matches when typing
  const { leads, list: found, err } = useLeadSearch(true, q)
  const matches = useMemo(() => matchLeads(design, leads || []), [design, leads])
  const list = useMemo(() => {
    if (q.trim()) return found
    return [...matches, ...(leads || []).filter((c) => !matches.includes(c))].slice(0, 25)
  }, [q, found, matches, leads])
  const matched = useMemo(() => new Set(matches.map((c) => c.id)), [matches])
  return (
    <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line, #294059)', borderRadius: 8 }}>
      <input style={FIELD} autoFocus placeholder="Search leads: name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
      {err ? <div className="error-banner" style={{ marginTop: 6 }}>{err}</div> : null}
      <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
        {leads === null ? <div style={MUTED}>Loading leads…</div> : list.map((c) => (
          <button key={c.id} type="button" disabled={busy} onClick={() => { if (!busy) onPick(c) }}
            style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 10, padding: '7px 8px', background: 'none', border: 0, borderBottom: '1px solid var(--line, #294059)', color: 'var(--fg, #e2e8f0)', textAlign: 'left', cursor: 'pointer' }}>
            <span><b style={{ fontWeight: 600 }}>{c.name || '—'}</b>{matched.has(c.id) ? <span style={{ color: '#22d3c8', marginLeft: 8, fontSize: 12 }}>matches</span> : null}</span>
            <span style={MUTED}>{c.phone || c.email || ''}</span>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'right', marginTop: 6 }}><button type="button" className="btn-secondary" style={SMALL} onClick={onCancel}>Cancel</button></div>
    </div>
  )
}

function Row({ d, onDone }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [attaching, setAttaching] = useState(false)
  const [busy, setBusy] = useState(false)

  async function attachTo(c) {
    if (busy) return
    setBusy(true)
    try {
      await attachDesign(supabase, d, c.id, user?.id)
      toast(`Design attached to ${escHtml(c.name || 'the lead')}`, 'success')
      onDone()
    } catch (e) {
      toast(escHtml(e.message || 'Could not attach the design.'))
      if (e.alreadyAttached) onDone() // someone else attached it: refresh the list
    } finally { setBusy(false) }
  }
  async function newLead() {
    if (busy) return
    setBusy(true)
    try {
      const dups = await findDuplicateClients({ email: d.email, phone: d.phone })
      if (dups.length && !window.confirm(`A lead with this phone or email already exists: ${dupSummary(dups)}.\n\nMake a NEW lead anyway? (Cancel, then use "Attach to a lead" to put the design on the existing one.)`)) { setBusy(false); return }
      const { data, error } = await supabase.from('clients').insert({
        name: d.name,
        phone: d.phone || null,
        email: d.email || null,
        zip: d.zip || null,
        status: 'new_lead',
        primary_rep: user?.id ?? null,
        first_contact_date: isoToday(),
      }).select().single()
      if (error) throw error
      await attachDesign(supabase, d, data.id, user?.id)
      toast(`New lead made for ${escHtml(d.name)}, with the design`, 'success')
      onDone()
      navigate(`/clients/${data.id}`)
    } catch (e) { toast(escHtml(e.message || 'Could not make the lead.')) } finally { setBusy(false) }
  }
  async function remove() {
    if (!window.confirm('Remove this design? It will no longer show here.')) return
    try { await markDesign(supabase, d.id, { status: 'dismissed' }, user?.id); onDone() } catch (e) { toast(escHtml(e.message || 'Could not remove it.')) }
  }

  const actions = (
    <>
      <button type="button" className="btn-primary" style={SMALL} disabled={busy} onClick={() => setAttaching((v) => !v)}>Attach to a lead</button>
      <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={newLead}>Make a new lead</button>
      <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={remove}>Remove</button>
    </>
  )
  return (
    <div>
      <DesignItem d={d} onChanged={onDone} actions={actions} />
      {attaching ? <AttachPicker design={d} busy={busy} onPick={attachTo} onCancel={() => setAttaching(false)} /> : null}
    </div>
  )
}

export default function UnassignedDesigns() {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    let run = 0
    async function load() {
      const my = ++run
      const r = await loadUnassignedDesigns(supabase)
      if (alive && my === run) setRows(r.rows)
    }
    load()
    // many changes close together (a burst of sends) = one reload
    let t = null
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500) }
    const ch = supabase.channel('designs-unassigned')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_requests' }, soon)
      .subscribe()
    window.addEventListener('ss:designs-updated', soon)
    return () => { alive = false; clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener('ss:designs-updated', soon) }
  }, [])

  useEffect(() => { if (open && rows.length === 0) setOpen(false) }, [open, rows.length])

  if (!rows.length) return null
  const done = () => window.dispatchEvent(new CustomEvent('ss:designs-updated'))
  return (
    <>
      <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', marginBottom: 12, borderColor: 'rgba(34,211,200,.45)' }}>
        <span>
          <b style={{ color: '#22d3c8' }}>{rows.length} customer design{rows.length === 1 ? '' : 's'}</b> sent from a design link {rows.length === 1 ? 'is' : 'are'} not on a lead yet.
        </span>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Review</button>
      </div>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Customer designs not on a lead"
          style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div style={{ width: 'min(760px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto', background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)', borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Customer designs not on a lead</div>
                <div style={MUTED}>Attach each one to its lead (leads with the same phone, email or name are listed first), or make a new lead.</div>
              </div>
              <button type="button" className="btn-secondary" style={{ padding: '4px 10px' }} aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            {rows.map((d) => <Row key={d.id} d={d} onDone={done} />)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
