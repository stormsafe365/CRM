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
import { agoLabel, fmtLong, fmtTime } from '../lib/followups'
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

function buildMilestones(client, hasQuote) {
  const ordered = client.status === 'ordered'
  const contractSent = client.status === 'contract_sent' || ordered
  const idx = PROJ_ORDER.indexOf(client.project_stage)
  const projAt = (s) => idx >= 0 && idx >= PROJ_ORDER.indexOf(s)
  return [
    { label: 'Lead Created', done: true },
    { label: 'Quote Sent', done: hasQuote },
    { label: 'Contract Sent', done: contractSent },
    { label: 'Contract Signed', done: ordered },
    { label: 'Deposit Received', done: ordered && !!client.payment_cleared },
    { label: 'Engineering', done: ordered && projAt('engineering') },
    { label: 'Permitting', done: ordered && projAt('permitting') },
    { label: 'Scheduling', done: ordered && projAt('scheduling') },
    { label: 'Installed', done: ordered && client.project_stage === 'installed' },
  ]
}

export default function ActivityProgress({ client, showAudience = false }) {
  const { users } = useUsers()
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
    { status: 'working' },                                // 1 Quote Sent
    { status: 'contract_sent' },                          // 2 Contract Sent
    { status: 'ordered' },                                // 3 Contract Signed
    { status: 'ordered', payment_cleared: true },         // 4 Deposit Received
    { status: 'ordered', project_stage: 'engineering' },  // 5 Engineering
    { status: 'ordered', project_stage: 'permitting' },   // 6 Permitting
    { status: 'ordered', project_stage: 'scheduling' },   // 7 Scheduling
    { status: 'ordered', project_stage: 'installed' },    // 8 Installed
  ]
  async function setMilestone(i) {
    const patch = STEP_PATCH[i]
    if (!patch) return
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
    if (error) {
      const m = (error.message || '').toLowerCase()
      toast(m.includes('project_stage') || m.includes('payment_cleared') || m.includes('schema cache')
        ? 'That stage needs the one-time database update before it will save.'
        : error.message)
      return
    }
    toast(`Stage updated to "${milestones[i].label}"`, 'success')
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
        <button type="button" className="expand-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Collapse' : 'Expand Activity'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
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
        </div>
        {a.body && <div className="tl-body">{a.body}</div>}
        <div className="tl-by muted">{userLabel(users, a.created_by) || 'System'}</div>
      </div>
    </div>
  )
}
