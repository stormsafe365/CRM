// DesignInbox: one customer design in the Customer Designs page (owner 10/16/26:
// "some of these people wont be added in to our leads just yet ... it's just
// gotta all land somewhere"). Every design shows here, on a lead or not:
//   on a lead      -> the lead's name + Open lead, Mark reviewed, Remove
//   not on a lead  -> Attach to a lead (same phone / email / name first),
//                     Make a new lead, Mark reviewed, Remove
// The picture, contact and spec come from DesignItem (CustomerDesignsCard).

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/uiFx'
import { isoToday } from '../lib/followups'
import { findDuplicateClients, dupSummary } from '../lib/dupCheck'
import { attachDesign, markDesign, matchLeads, escHtml, sharedFrom } from '../lib/designLinks'
import { useLeadSearch } from '../lib/useLeadSearch'
import { DesignItem } from './CustomerDesignsCard'

const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5,
}
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }
const SMALL = { padding: '4px 10px', fontSize: 12.5 }

function AttachPicker({ design, onPick, onCancel, busy }) {
  const [q, setQ] = useState('')
  // newest 1,000 leads (never Trash) + the server's name / email / phone matches when typing
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
        {leads === null ? <div style={MUTED}>Loading leads…</div> : list.length === 0 ? <div style={MUTED}>No lead matches.</div> : list.map((c) => (
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

/** d = a design_requests row; lead = { name, trashed } when it is on a lead; onDone = reload the list. */
export function DesignInboxRow({ d, lead, onDone }) {
  const leadName = lead && lead.name
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
      setAttaching(false)
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
      // still waiting? (another rep may have attached it a moment ago)
      const { data: cur } = await supabase.from('design_requests').select('client_id').eq('id', d.id).maybeSingle()
      if (cur && cur.client_id) { toast('This design was already attached to a lead (maybe by someone else just now).'); onDone(); setBusy(false); return }
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
      try {
        await attachDesign(supabase, d, data.id, user?.id)
      } catch (e) {
        if (!e.alreadyAttached) throw e
        // lost the race after making the lead: the new lead is empty — move it to Trash (recoverable)
        const { error: te } = await supabase.from('clients').update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null }).eq('id', data.id)
        toast(te ? `Someone attached this design first. Please delete the empty lead "${escHtml(d.name)}" you just made.` : 'Someone attached this design first, so the new lead was moved to Trash.')
        onDone()
        return
      }
      toast(`New lead made for ${escHtml(d.name)}, with the design`, 'success')
      onDone()
      navigate(`/clients/${data.id}`)
    } catch (e) { toast(escHtml(e.message || 'Could not make the lead.')) } finally { setBusy(false) }
  }
  async function setStatus(status) {
    if (status === 'dismissed' && !window.confirm('Remove this design? It will move to the Removed list.')) return
    try { await markDesign(supabase, d.id, { status }, user?.id); onDone() } catch (e) { toast(escHtml(e.message || 'Could not update the design.')) }
  }

  const onLead = !!d.client_id
  const actions = (
    <>
      {onLead ? (
        <Link className="btn-primary" style={{ ...SMALL, textDecoration: 'none' }} to={`/clients/${d.client_id}`}>Open lead{leadName ? `: ${leadName}` : ''}</Link>
      ) : (
        <>
          <button type="button" className="btn-primary" style={SMALL} disabled={busy} onClick={() => setAttaching((v) => !v)}>Attach to a lead</button>
          <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={newLead}>Make a new lead</button>
        </>
      )}
      {d.status === 'new' ? <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={() => setStatus('seen')}>Mark reviewed</button> : null}
      {d.status === 'dismissed'
        ? <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={() => setStatus('seen')}>Put back</button>
        : <button type="button" className="btn-secondary" style={SMALL} disabled={busy} onClick={() => setStatus('dismissed')}>Remove</button>}
    </>
  )
  return (
    <div>
      <div style={{ ...MUTED, marginTop: 12, marginBottom: -6 }}>
        {onLead ? <>On lead <b style={{ color: 'var(--fg, #e2e8f0)' }}>{leadName || '…'}</b>{lead && lead.trashed ? <span style={{ color: '#f0883e' }}> (the lead is in Trash: restore it from Trash to work it)</span> : null}</> : <span style={{ color: '#f0883e', fontWeight: 600 }}>Not on a lead yet</span>}
        {sharedFrom(d) ? <> · From: <b style={{ color: 'var(--fg, #e2e8f0)' }}>{sharedFrom(d)}</b> (shared link)</> : null}
      </div>
      <DesignItem d={d} onChanged={onDone} actions={actions} />
      {attaching ? <AttachPicker design={d} busy={busy} onPick={attachTo} onCancel={() => setAttaching(false)} /> : null}
    </div>
  )
}
