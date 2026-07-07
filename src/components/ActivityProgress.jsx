// ActivityProgress: the spec's combined "Activity & Progress" module — one
// collapsible card that merges a project progress tracker with the activity
// timeline + composer. Collapsed by default (compact stepper + last activity +
// next action); expanded reveals the full tracker, the log-touch composer, and
// the full history.
//
// Milestones are derived ONLY from real data we store (sales status, project
// stage, payment_cleared, whether a quote exists). We don't invent finer steps
// (e.g. "Customer opened quote") that we have no tracking for.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { useAuth } from '../context/AuthContext'
import { agoLabel, fmtLong, fmtTime } from '../lib/followups'
import { cadenceSeeded, seedPostQuoteCadence, POST_QUOTE_CADENCE } from '../lib/quoteCadence'
import ActivityComposer from './ActivityComposer'
import { toast } from '../lib/uiFx'

const TYPE_META = {
  call: { icon: '📞', label: 'Call' },
  note: { icon: '📝', label: 'Note' },
  email: { icon: '✉️', label: 'Email' },
  meeting: { icon: '🤝', label: 'Meeting' },
  status_change: { icon: '↪', label: 'Status change' },
  quote_created: { icon: '📄', label: 'Quote created' },
  quote_status_change: { icon: '📄', label: 'Quote update' },
  follow_up_set: { icon: '📅', label: 'Follow-up set' },
  follow_up_completed: { icon: '✓', label: 'Follow-up cleared' },
}

const PROJ_ORDER = ['engineering', 'permitting', 'scheduling', 'installed']

const STEP_LABELS = [
  'Lead Created', 'Attempting to Contact', 'Quote Sent', 'Contract Sent',
  'Contract Signed', 'Deposit Received', 'Engineering', 'Permitting',
  'Scheduling', 'Installed',
]

// How far down the linear stepper each sales status sits. Legacy/side values
// fold onto the nearest step so old rows still render sensibly.
const STATUS_RANK = {
  new_lead: 0,
  contacted: 1,
  working: 2, quoted: 2, follow_up: 2, working_hot: 2, deposit_pending: 2,
  contract_sent: 3,
  ordered: 4,
}

// One linear rank for where the client actually is, derived from the SAME
// fields the stepper clicks write (status / project_stage / payment_cleared).
// This keeps click → visible advance in lockstep: clicking a node writes the
// status, and the node then reads as done because its rank is reached.
function reachedRank(client, hasQuote) {
  let rank = STATUS_RANK[client.status] ?? 1
  if (hasQuote && rank < 2) rank = 2 // a saved quote means at least "Quote Sent"
  if (client.status === 'ordered') {
    rank = client.payment_cleared ? 5 : 4
    const idx = PROJ_ORDER.indexOf(client.project_stage)
    if (idx >= 0) rank = 6 + idx // engineering=6 … installed=9
  }
  return rank
}

function buildMilestones(client, hasQuote) {
  const rank = reachedRank(client, hasQuote)
  return STEP_LABELS.map((label, i) => ({ label, done: i <= rank }))
}

export default function ActivityProgress({ client, showAudience = false, onMarkOrdered }) {
  const { users } = useUsers()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [acts, setActs] = useState([])
  const [hasQuote, setHasQuote] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [a, q] = await Promise.all([
        supabase.from('activities').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
        supabase.from('quotes').select('id').eq('client_id', client.id).limit(1),
      ])
      if (cancelled) return
      setActs(a.data ?? [])
      setHasQuote((q.data ?? []).length > 0)
      setLoading(false)
    }
    load()
    const ch = supabase
      .channel(`actprog-${client.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `client_id=eq.${client.id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes', filter: `client_id=eq.${client.id}` }, () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [client.id])

  const milestones = buildMilestones(client, hasQuote)
  const currentIdx = milestones.findIndex(m => !m.done)
  const last = acts[0]
  const nextAction = client.follow_up_date
    ? `Follow up ${fmtLong(client.follow_up_date)}${client.follow_up_time ? ` · ${fmtTime(client.follow_up_time)}` : ''}`
    : 'No follow-up scheduled'

  // Clicking a step advances the client to that milestone. Maps the design's
  // linear stepper onto the app's real status / project_stage fields. The
  // 'Lead Created' step is fixed (always done), so it isn't clickable.
  const STEP_PATCH = [
    null,                                                 // 0 Lead Created (fixed)
    { status: 'contacted' },                              // 1 Attempting to Contact
    { status: 'working' },                                // 2 Quote Sent
    { status: 'contract_sent' },                          // 3 Contract Sent
    { status: 'ordered' },                                // 4 Contract Signed
    { status: 'ordered', payment_cleared: true },         // 5 Deposit Received
    { status: 'ordered', project_stage: 'engineering' },  // 6 Engineering
    { status: 'ordered', project_stage: 'permitting' },   // 7 Permitting
    { status: 'ordered', project_stage: 'scheduling' },   // 8 Scheduling
    { status: 'ordered', project_stage: 'installed' },    // 9 Installed
  ]
  async function setMilestone(i) {
    const patch = STEP_PATCH[i]
    if (!patch) return
    // "Deposit Received" (step 5) always opens the Mark-as-Ordered box so you can
    // set the order date + follow-up timeframes before the lead lands in
    // Follow-Up HQ. Other ordered steps open it too when the order details are
    // still missing. Same box as the summary "Mark as Ordered" button.
    if (onMarkOrdered && (i === 5 || (patch.status === 'ordered' && !client.order_date))) {
      onMarkOrdered()
      return
    }
    // Reaching any "ordered" milestone (Contract Signed, Deposit Received, …)
    // also moves the summary lead-temperature bar to Ordered, so the gauge and
    // the stepper stay in sync.
    const finalPatch = patch.status === 'ordered' ? { ...patch, lead_temperature: 'ordered' } : patch
    const { error } = await supabase.from('clients').update(finalPatch).eq('id', client.id)
    if (error) {
      const m = (error.message || '').toLowerCase()
      toast(m.includes('project_stage') || m.includes('payment_cleared') || m.includes('schema cache')
        ? 'That stage needs the one-time database update before it will save.'
        : error.message)
      return
    }
    toast(`Stage updated to "${milestones[i].label}"`, 'success')

    // Marking "Quote Sent" offers to kick off the post-quote reminder cadence
    // (team check-ins). Reminders only — nothing auto-sends to the customer.
    if (i === 2 && !(await cadenceSeeded(client.id))) {
      if (window.confirm(`Quote sent! Start the post-quote follow-up sequence? This adds ${POST_QUOTE_CADENCE.length} reminders (Day 3, Week 1, Week 3, Week 6) for the team to check in with this lead.`)) {
        const res = await seedPostQuoteCadence(client, user?.id)
        if (res.seeded) toast(`Added ${res.count} follow-up reminders.`, 'success')
        else if (res.error) toast(res.error.message)
      }
    }
  }

  return (
    <section className="card card-pad ap-card">
      <div className="section-head"><h3>Activity &amp; Progress</h3></div>

      {/* Progress stepper — always visible (design 10-node style) */}
      <div className="stepper">
        {milestones.map((m, i) => (
          <div key={m.label} className={`step${m.done ? ' done' : ''}${i === currentIdx ? ' current' : ''}`}
            onClick={() => setMilestone(i)} role={i === 0 ? undefined : 'button'}
            title={i === 0 ? undefined : `Set stage to “${m.label}”`}
            style={{ cursor: i === 0 ? 'default' : 'pointer' }}>
            <div className="step-node">
              {m.done
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : (i + 1)}
            </div>
            <div className="step-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Compact summary — always visible */}
      <div className="activity-foot">
        <div className="act-block">
          <div className="lab">Last Activity</div>
          <div className="val">
            <span className="dot" />
            {loading ? '…' : last
              ? `${(TYPE_META[last.type]?.label) || last.type}${last.body ? ` — ${last.body.length > 60 ? last.body.slice(0, 60) + '…' : last.body}` : ''} · ${agoLabel(last.created_at.slice(0, 10))}`
              : 'No activity yet'}
          </div>
        </div>
        <div className="act-block">
          <div className="lab">Next Action</div>
          <div className="val">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
            {nextAction}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          {onMarkOrdered && (
            <button
              type="button"
              onClick={onMarkOrdered}
              title={client.status === 'ordered' ? 'Edit order details' : 'Mark this lead as ordered'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                padding: '9px 14px', borderRadius: 'var(--r-md)', fontFamily: 'var(--font-head, inherit)',
                fontWeight: 700, fontSize: 12.5, letterSpacing: '.03em', whiteSpace: 'nowrap',
                background: client.status === 'ordered' ? 'transparent' : 'var(--lime, #8FD14F)',
                color: client.status === 'ordered' ? 'var(--cyan)' : '#08121d',
                border: client.status === 'ordered' ? '1px solid rgba(9,214,220,0.45)' : 'none',
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {client.status === 'ordered' ? 'Edit Order' : 'Mark as Ordered'}
            </button>
          )}
          <button type="button" className="expand-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            {open ? 'Collapse' : 'Expand Activity'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>
      </div>

      {/* Expanded: composer + full timeline */}
      {open && (
        <div className="ap-expanded" style={{ marginTop: 20 }}>
          <ActivityComposer client={client} showAudience={showAudience} />
          <div className="timeline">
            {loading ? (
              <div className="muted">Loading…</div>
            ) : acts.length === 0 ? (
              <div className="empty-state">No activity yet — log your first touch above.</div>
            ) : (
              acts.map(a => <ActivityRow key={a.id} a={a} users={users} />)
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function ActivityRow({ a, users }) {
  const m = TYPE_META[a.type] || { icon: '•', label: a.type }
  const aud = a.metadata?.audience
  const when = new Date(a.created_at)
  // Only the manual touches you logged are editable — not the auto entries
  // (status changes, quote created, follow-up set, etc.).
  const editable = ['call', 'note', 'email', 'meeting'].includes(a.type)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(a.body || '')
  const [busy, setBusy] = useState(false)

  async function saveEdit() {
    setBusy(true)
    const { error } = await supabase.from('activities').update({ body: draft.trim() || null }).eq('id', a.id)
    setBusy(false)
    if (!error) setEditing(false) // realtime reload refreshes the timeline
  }
  async function del() {
    if (!window.confirm('Delete this log entry? This cannot be undone.')) return
    await supabase.from('activities').delete().eq('id', a.id)
  }

  return (
    <div className="tl-item">
      <div className="tl-icon" aria-hidden>{m.icon}</div>
      <div className="tl-main">
        <div className="tl-head">
          <span className="tl-type">{m.label}</span>
          {aud === 'manufacturer' && <span className="tl-aud factory">Factory</span>}
          {aud === 'client' && <span className="tl-aud">Client</span>}
          <span className="tl-when">
            {when.toLocaleDateString()} · {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          {editable && !editing && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 12, flex: '0 0 auto' }}>
              <span className="link-cyan" role="button" onClick={() => { setDraft(a.body || ''); setEditing(true) }}>Edit</span>
              <span className="link-cyan" role="button" style={{ color: 'var(--danger)' }} onClick={del}>Delete</span>
            </span>
          )}
        </div>
        {editing ? (
          <div style={{ marginTop: 8 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <textarea rows={3} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          a.body && <div className="tl-body">{a.body}</div>
        )}
        <div className="tl-by muted">{userLabel(users, a.created_by) || 'System'}</div>
      </div>
    </div>
  )
}
