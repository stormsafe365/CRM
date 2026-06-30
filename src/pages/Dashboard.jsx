// Dashboard: command-center view, styled to match the prototype.
// Two-track aware: SALES leads (broken into the subcategories Jenna asked
// for) are kept separate from ORDERED / in-project clients so they never
// get mixed up. All figures derive from live Supabase data; empty states
// show when there isn't enough data yet rather than faking numbers.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  statusLabel, PROJECT_STAGES, projectStageLabel,
  WORKING_STATUSES, DEAD_STATUSES,
} from '../lib/constants'
import { useAuth } from '../context/AuthContext'
import { useCountUp } from '../lib/useCountUp'
import { isoToday, fmtTime } from '../lib/followups'
import Sparkline from '../components/Sparkline'
import { AreaChart, Donut, Gauge } from '../components/charts'
import DashCalendar from '../components/DashCalendar'
import { toast } from '../lib/uiFx'

const DAY = 86400000
const moneyShort = (n) =>
  n >= 1000 ? '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K' : '$' + Math.round(n)

const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'verbal_accept']

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('7D')

  useEffect(() => {
    let cancelled = false
    async function load() {
      // select('*') so a missing optional column (e.g. project_stage before
      // its migration runs) never makes the whole query fail.
      const [c, q] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('quotes').select('id, client_id, status, manufacturer, total_amount, created_at'),
      ])
      if (cancelled) return
      setClients((c.data ?? []).filter(x => !x.deleted_at))
      setQuotes((q.data ?? []).filter(x => !x.deleted_at))
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [])

  // Local calendar date (not UTC) so "due today" matches how follow_up_date is
  // stored and what the Today page / nav badge use. A UTC date here made evening
  // follow-ups silently drop off the Dashboard for US-timezone users.
  const today = isoToday()
  const weekAgoISO = new Date(Date.now() - 7 * DAY).toISOString()
  const monthStartISO = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() })()

  /* ---------- lead subcategories (Jenna's list) ---------- */
  const buckets = useMemo(() => {
    const isNewLead = c => c.status === 'new_lead'
    return {
      newLeadsWeek: clients.filter(c => isNewLead(c) && c.created_at && c.created_at >= weekAgoISO),
      newLeadsMonth: clients.filter(c => isNewLead(c) && c.created_at && c.created_at >= monthStartISO),
      newLeads: clients.filter(isNewLead),
      attempting: clients.filter(c => c.status === 'contacted'),
      working: clients.filter(c => ['working', 'quoted', 'follow_up'].includes(c.status)),
      hot: clients.filter(c => c.status === 'working_hot'),
      contractSent: clients.filter(c => c.status === 'contract_sent'),
      activeWorking: clients.filter(c => WORKING_STATUSES.includes(c.status)),
      dead: clients.filter(c => DEAD_STATUSES.includes(c.status)),
      ordered: clients.filter(c => c.status === 'ordered'),
    }
  }, [clients, weekAgoISO, monthStartISO])

  /* ---------- follow-ups ---------- */
  const overdue = useMemo(() =>
    clients.filter(c => c.follow_up_date && c.follow_up_date < today)
      .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date)),
    [clients, today])
  const dueToday = useMemo(() =>
    clients.filter(c => c.follow_up_date === today), [clients, today])

  // Ordered clients whose deposit/ACH hasn't cleared yet.
  const pendingPay = useMemo(() =>
    clients.filter(c => c.status === 'ordered' && !c.payment_cleared), [clients])

  /* ---------- project-stage breakdown (ordered clients) ---------- */
  const projectBreakdown = useMemo(() => {
    const counts = {}
    for (const s of PROJECT_STAGES) counts[s.value] = 0
    for (const c of buckets.ordered) {
      const stage = c.project_stage || 'ordered'
      counts[stage] = (counts[stage] ?? 0) + 1
    }
    const max = Math.max(1, ...Object.values(counts))
    return PROJECT_STAGES.map(s => ({ ...s, count: counts[s.value], scale: counts[s.value] / max }))
  }, [buckets.ordered])

  /* ---------- new-clients sparkline (last 7 days) ---------- */
  const newClientSpark = useMemo(() => {
    const b = Array(7).fill(0)
    const start = Date.now() - 6 * DAY
    for (const c of clients) {
      if (!c.created_at) continue
      const idx = Math.floor((new Date(c.created_at).getTime() - start) / DAY)
      if (idx >= 0 && idx < 7) b[idx]++
    }
    return b.some(v => v > 0) ? b : [0, 0, 0, 0, 0, 0, 0]
  }, [clients])

  /* ---------- charts ---------- */
  const area = useMemo(() => buildQuoteSeries(quotes, period), [quotes, period])
  const mfr = useMemo(() => {
    const open = quotes.filter(q => OPEN_QUOTE_STATUSES.includes(q.status))
    const ca = open.filter(q => q.manufacturer === 'ca').reduce((a, q) => a + Number(q.total_amount || 0), 0)
    const cci = open.filter(q => q.manufacturer === 'cci').reduce((a, q) => a + Number(q.total_amount || 0), 0)
    return { ca, cci, total: ca + cci }
  }, [quotes])
  const winRate = useMemo(() => {
    const won = quotes.filter(q => q.status === 'deposit_paid').length
    const lost = quotes.filter(q => q.status === 'declined').length
    const denom = won + lost
    return { frac: denom ? won / denom : 0, denom }
  }, [quotes])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = (user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? 'there')
    .split(' ')[0].replace(/^./, c => c.toUpperCase())
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  if (loading) return <div className="muted" style={{ padding: '24px 0' }}>Loading dashboard…</div>

  return (
    <>
      <div className="greet">
        <h1>{greeting}, <span>{firstName}</span></h1>
        <p>
          You have <b>{dueToday.length} {dueToday.length === 1 ? 'follow-up' : 'follow-ups'}</b> due today
          {overdue.length > 0 && <> and <span className="amberword">{overdue.length} overdue</span></>}.
          &nbsp;{dateStr}
        </p>
      </div>

      {/* KPI row — leads vs ordered kept separate */}
      <section className="kpis stagger">
        <KpiCard i={0} label="New Leads · This Week" value={buckets.newLeadsWeek.length}
          sub={`${buckets.newLeadsMonth.length} this month`} spark={newClientSpark} to="/clients?view=new_lead" />
        <KpiCard i={1} label="Active Working Leads" value={buckets.activeWorking.length}
          sub="Working · hot · contract sent" spark={newClientSpark} to="/clients?view=working" />
        <KpiCard i={2} label="Ordered · In Project" value={buckets.ordered.length}
          sub="Deposit paid + contract signed" spark={newClientSpark} to="/clients?view=ordered" />
        <KpiCard i={3} label="Due Today" value={dueToday.length}
          accent={dueToday.length > 0 ? 'amber' : null}
          sparkColor={dueToday.length > 0 ? 'var(--amber)' : 'var(--cyan)'}
          sub="Follow-ups scheduled" spark={[0, 1, 0, 2, 1, 1, dueToday.length]} to="/followups" />
      </section>

      {/* Charts row */}
      <section className="charts stagger">
        <div className="panel" style={{ '--i': 4 }}>
          <div className="panel-title">
            <h3>Quotes Sent</h3>
            <div className="seg">
              {['7D', '30D', 'QTR'].map(p => (
                <button key={p} className={p === period ? 'on' : ''} onClick={() => setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>
          <AreaChart points={area.points} labels={area.labels} peakText={area.peakText} />
        </div>

        <button className="panel launcher" style={{ '--i': 5 }} onClick={() => window.open('/quote-builder.html', '_blank', 'noopener')}>
          <div className="launcher-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></div>
          <div className="launcher-title">QTE Builder</div>
          <div className="launcher-sub">Open the pricing &amp; quote tool</div>
        </button>

        <button className="panel launcher" style={{ '--i': 6 }} onClick={() => navigate('/layout')}>
          <div className="launcher-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg></div>
          <div className="launcher-title">2D Layout</div>
          <div className="launcher-sub">Lay out doors, windows &amp; openings</div>
        </button>
      </section>

      <section className="stagger" style={{ marginBottom: 16 }}>
        <DashCalendar />
      </section>

      {/* Lower row — breakdowns + follow-ups */}
      <section className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {/* Active clients breakdown — Jenna's subcategories */}
        <div className="panel" style={{ '--i': 7 }}>
          <div className="panel-title"><h3>Active Clients</h3></div>
          <StatRow label="New Leads · This Week" count={buckets.newLeadsWeek.length} to="/clients?view=new_lead" />
          <StatRow label="Attempting to Contact" count={buckets.attempting.length} to="/clients?view=contacted" />
          <StatRow label="Working Leads" count={buckets.working.length} to="/clients?view=working" />
          <StatRow label="Working Hot Leads" count={buckets.hot.length} to="/clients?view=working_hot" />
          <StatRow label="Contract Sent" count={buckets.contractSent.length} to="/clients?view=contract_sent" />
          <StatRow label="Dead" count={buckets.dead.length} to="/clients?view=dead" dim />
        </div>

        {/* Project stage breakdown — ordered clients only */}
        <div className="panel" style={{ '--i': 8 }}>
          <div className="panel-title"><h3>Project Stage</h3></div>
          {buckets.ordered.length === 0 ? (
            <div className="muted" style={{ padding: '6px 0', fontSize: 13 }}>No ordered projects yet.</div>
          ) : projectBreakdown.map((s, idx) => (
            <div key={s.value} className="stage-row">
              <div className="label">{s.label}</div>
              <div className="stage-bar"><div className="stage-bar-fill" style={{ '--i': idx, '--scale': s.scale }} /></div>
              <div className="count num">{s.count}</div>
            </div>
          ))}
        </div>

        {/* Follow-ups due today */}
        <div className="panel" style={{ '--i': 9 }}>
          <div className="panel-title">
            <h3>Follow-ups Due Today</h3>
            <Link to="/clients" className="link-btn" style={{ fontSize: 12 }}>View all</Link>
          </div>
          {dueToday.length === 0 ? (
            <div className="muted" style={{ padding: '6px 0', fontSize: 13 }}>Nothing due today.</div>
          ) : (
            <div className="fu">
              {dueToday.map(c => (
                <Link key={c.id} to={`/clients/${c.id}`} className="fu-item">
                  <span className="fu-date">{fmtDate(c.follow_up_date)}{c.follow_up_time ? ` · ${fmtTime(c.follow_up_time)}` : ''}</span>
                  <span className="fu-name">{c.name}</span>
                  <span className="fu-status">{statusLabel(c.status)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Needs attention — overdue */}
        <div className="panel urgent" style={{ '--i': 10 }}>
          <div className="panel-title"><h3>Needs Attention</h3></div>
          {pendingPay.length === 0 && overdue.length === 0 ? (
            <div className="muted" style={{ padding: '6px 0', fontSize: 13 }}>Nothing needs attention. Nice.</div>
          ) : (
            <div className="fu">
              {pendingPay.map(c => (
                <Link key={'pay-' + c.id} to={`/clients/${c.id}`} className="fu-item">
                  <span className="fu-date follow-up-overdue">PENDING</span>
                  <span className="fu-name">{c.name}</span>
                  <span className="fu-status">Payment not cleared</span>
                </Link>
              ))}
              {overdue.map(c => (
                <Link key={c.id} to={`/clients/${c.id}`} className="fu-item">
                  <span className="fu-date follow-up-overdue">{fmtDate(c.follow_up_date)}</span>
                  <span className="fu-name">{c.name}</span>
                  <span className="fu-status">{statusLabel(c.status)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

/* ---------- small stat row (label + count) ---------- */
function StatRow({ label, count, dim, to }) {
  const inner = (
    <>
      <span className="stat-label" style={dim ? { color: 'var(--txt-3)' } : undefined}>{label}</span>
      <span className="stat-count num" style={dim ? { color: 'var(--txt-3)' } : undefined}>{count}</span>
    </>
  )
  return to
    ? <Link to={to} className="stat-row stat-row-link">{inner}</Link>
    : <div className="stat-row">{inner}</div>
}

/* ---------- KPI card ---------- */
function KpiCard({ i, label, value, sub, spark, sparkColor, accent, to, format }) {
  const display = useCountUp(value)
  const className = `panel kpi${accent ? ` ${accent}` : ''}`
  const shown = format ? format(display) : Math.round(display).toLocaleString()
  const content = (
    <>
      <div className="label">{label}</div>
      <div className="value num">{shown}</div>
      <div className="sub">{sub}</div>
      {spark && <Sparkline points={spark} color={sparkColor} />}
    </>
  )
  return to
    ? <Link to={to} className={className} style={{ '--i': i }}>{content}</Link>
    : <div className={className} style={{ '--i': i }}>{content}</div>
}

/* ---------- area-chart series builder ---------- */
function buildQuoteSeries(quotes, period) {
  const now = Date.now()
  let bk, labels, keyOf
  if (period === '7D') {
    bk = Array(7).fill(0)
    const start = now - 6 * DAY
    labels = Array.from({ length: 7 }, (_, i) => new Date(start + i * DAY).toLocaleDateString(undefined, { weekday: 'short' }))
    keyOf = (t) => Math.floor((t - start) / DAY)
  } else if (period === '30D') {
    bk = Array(5).fill(0)
    const start = now - 34 * DAY
    labels = ['W1', 'W2', 'W3', 'W4', 'W5']
    keyOf = (t) => Math.floor((t - start) / (7 * DAY))
  } else {
    bk = Array(6).fill(0)
    const d0 = new Date(); d0.setMonth(d0.getMonth() - 5, 1)
    labels = Array.from({ length: 6 }, (_, i) => { const d = new Date(d0); d.setMonth(d0.getMonth() + i); return d.toLocaleDateString(undefined, { month: 'short' }) })
    keyOf = (t) => { const d = new Date(t); return (d.getFullYear() - d0.getFullYear()) * 12 + (d.getMonth() - d0.getMonth()) }
  }
  for (const q of quotes) {
    if (!q.created_at) continue
    const idx = keyOf(new Date(q.created_at).getTime())
    if (idx >= 0 && idx < bk.length) bk[idx]++
  }
  const peak = Math.max(...bk)
  const peakIdx = bk.indexOf(peak)
  return { points: bk, labels, peakText: peak > 0 ? `${labels[peakIdx]} · ${peak} quote${peak === 1 ? '' : 's'}` : '' }
}

function fmtDate(yyyyMMdd) {
  const [, m, d] = yyyyMMdd.split('-')
  return `${m}/${d}`
}
