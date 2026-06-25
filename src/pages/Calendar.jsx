// Calendar: the Follow-Up HQ — the richer follow-up tracker (stages, reps,
// reminders, order auto-scheduler) embedded same-origin at /follow-up-hq.html.
//
// CRM LINK: the CRM is the source of truth for *people*. This page pushes the
// live client list into the calendar (over postMessage, kept fresh by Supabase
// realtime), so reps never re-enter leads. The calendar mirrors them keyed by
// crmId; order/timeline details + completion stay in the calendar tool itself.

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'

// Map a CRM (status, project_stage) to one of the calendar's board stages.
// Returns null for leads we don't surface on the follow-up board (lost/cancelled).
function mapStage(c) {
  const st = c.status, ps = c.project_stage
  if (st === 'lost' || st === 'cancelled') return null
  const ordered = ['ordered', 'deposit_paid', 'scheduled', 'installed', 'done'].includes(st)
  if (ordered) {
    if (ps === 'installed' || st === 'installed') return 'post'
    if (st === 'done') return 'closed'
    if (ps === 'scheduling' || st === 'scheduled') return 'install'
    if (ps === 'permitting') return 'site'
    if (ps === 'engineering') return 'plans'
    return 'deposit'
  }
  return 'quote' // new_lead, contacted, quoted, follow_up, contract_sent, deposit_pending…
}

export default function Calendar() {
  const { users } = useUsers()
  const iframeRef = useRef(null)
  const readyRef = useRef(false)
  const [clients, setClients] = useState([])

  // Load the client list + keep it live via realtime.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('clients')
        .select('id,name,phone,city,county,status,project_stage,primary_rep,building_size,building_type,order_date,order_mfr,order_plan,order_bucket')
        .order('updated_at', { ascending: false })
      if (!cancelled) setClients(data || [])
    }
    load()
    const ch = supabase
      .channel('cal-clients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [])

  // Push the current snapshot into the calendar iframe (once it's ready).
  const post = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win || !readyRef.current) return
    const payload = clients.map(c => {
      const stage = mapStage(c)
      if (!stage) return null
      return {
        crmId: c.id,
        name: c.name,
        phone: c.phone || '',
        city: c.city || '',
        county: c.county || '',
        building: [c.building_size, c.building_type].filter(Boolean).join(' '),
        rep: userLabel(users, c.primary_rep),
        stage,
        // Order details (set on the client portal) drive the auto-built timeline.
        ordered: c.order_date || null,
        mfr: c.order_mfr || null,
        planKey: c.order_plan || null,
        bucket: c.order_bucket || null,
      }
    }).filter(Boolean)
    win.postMessage({ type: 'ss-crm-clients', clients: payload }, '*')
  }, [clients, users])

  // Re-push whenever the data changes.
  useEffect(() => { post() }, [post])

  // The calendar announces itself when its script boots — push immediately then.
  useEffect(() => {
    function onMsg(e) {
      if (e.data && e.data.type === 'ss-crm-ready') { readyRef.current = true; post() }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [post])

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Schedule</div>
          <h1>Follow-Up HQ</h1>
          <div className="sub">Every lead from your CRM, on a stage board with auto-built order timelines and reminders.</div>
        </div>
        <div className="right">
          <a className="btn btn-ghost" href="/follow-up-hq.html" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></svg>
            Open in new tab
          </a>
        </div>
      </div>

      <section className="tile" style={{ padding: 0, overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src="/follow-up-hq.html"
          title="StormSafe Follow-Up HQ"
          onLoad={() => post()}
          style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 600, border: 0, display: 'block', background: 'var(--bg)' }}
        />
      </section>
    </>
  )
}
