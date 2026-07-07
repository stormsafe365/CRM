// Dashboard — command-center view, rebuilt to the Claude Design "CRM Dashboard
// Redesign" handoff: greeting + action row, seasonal storm strip, KPI row,
// full-width follow-up calendar, Build & Quote tools, a compact Quotes-Sent
// strip, and a 4-panel bottom row. The DESIGN is ported; every value is wired
// to live Supabase data (the mockup's sample numbers are NOT used). Mapped onto
// the app's existing tokens (cyan/lime/amber, Orbitron heads) for consistency
// with the rest of the CRM.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  statusLabel, PROJECT_STAGES,
  WORKING_STATUSES, DEAD_STATUSES,
} from '../lib/constants'
import { useAuth } from '../context/AuthContext'
import { useCountUp } from '../lib/useCountUp'
import { isoToday, fmtTime } from '../lib/followups'
import { readState } from '../lib/ssfuEngine'
import { derivedProjectStage } from '../lib/projectStage'
import { AreaChart } from '../components/charts'
import DashCalendar from '../components/DashCalendar'
import BuildQuoteModal from '../components/BuildQuoteModal'

const DAY = 86400000

/* ---- Lucide-style inline icons (2px stroke, matches the shell) ---- */
const ico = {
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></>,
  sparkles: <><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></>,
  hardHat: <><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a8 8 0 0 0-16 0" /><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" /><path d="M4 15v-3a6 6 0 0 1 6-6M20 15v-3a6 6 0 0 0-6-6" /></>,
  calClock: <><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M16 2v4M8 2v4M3 10h18" /><circle cx="18" cy="18" r="4" /><path d="M18 16.5V18l1 1" /></>,
  fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></>,
  arrowR: <><path d="M5 12h14M12 5l7 7-7 7" /></>,
  wind: <><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
}
const Icon = ({ d, w = 18, style }) => (
  <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>{d}</svg>
)
const Eyebrow = ({ children }) => (
  <div className="dsh-eyebrow"><span className="dsh-bar" />{children}</div>
)

const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'verbal_accept']

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('7D')
  const [building, setBuilding] = useState(false) // "New Quote" → same builder as client-portal Build Quote
  const [ssfu, setSsfu] = useState(() => readState()) // Follow-Up HQ milestone store (ssfu_v8)

  // Re-read the Follow-Up HQ store on focus / when it changes, so the Project
  // Stage box stays in sync with what's managed in Follow-Up HQ.
  useEffect(() => {
    const refresh = () => setSsfu(readState())
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
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

  const today = isoToday()
  const weekAgoISO = new Date(Date.now() - 7 * DAY).toISOString()
  const monthStartISO = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() })()

  /* ---------- lead subcategories ---------- */
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
  // Ordered clients follow the Follow-Up HQ timeline (not clients.follow_up_date),
  // and dead/lost/cancelled leads aren't chased — none should surface as an
  // overdue lead follow-up in "Needs Attention".
  const NO_LEAD_FU = ['ordered', 'dead', 'lost', 'cancelled']
  const overdue = useMemo(() =>
    clients.filter(c => c.follow_up_date && c.follow_up_date < today && !NO_LEAD_FU.includes(c.status))
      .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date)),
    [clients, today])
  const dueToday = useMemo(() =>
    clients.filter(c => c.follow_up_date === today && !NO_LEAD_FU.includes(c.status)), [clients, today])
  const pendingPay = useMemo(() =>
    clients.filter(c => c.status === 'ordered' && !c.payment_cleared), [clients])

  // Real week-over-week lead inflow (created this week vs the 7 days before).
  const leadDelta = useMemo(() => {
    const now = Date.now()
    const inWin = (lo, hi) => clients.filter(c => {
      if (!c.created_at) return false
      const t = new Date(c.created_at).getTime()
      return t >= now - lo * DAY && t < now - hi * DAY
    }).length
    return inWin(7, 0) - inWin(14, 7)
  }, [clients])

  /* ---------- project-stage breakdown ----------
   * Derives each ordered client's stage from the Follow-Up HQ milestone system
   * (ssfu_v8) — the furthest milestone checked off — so it matches what's
   * managed there. Falls back to clients.project_stage (set by the client-page
   * stepper) when a client has no milestone progress yet. */
  const projectBreakdown = useMemo(() => {
    const counts = {}
    for (const s of PROJECT_STAGES) counts[s.value] = 0
    for (const c of buckets.ordered) {
      const stage = derivedProjectStage(c, ssfu)
      counts[stage] = (counts[stage] ?? 0) + 1
    }
    const max = Math.max(1, ...Object.values(counts))
    return PROJECT_STAGES.map(s => ({ ...s, count: counts[s.value], scale: counts[s.value] / max }))
  }, [buckets.ordered, ssfu])

  /* ---------- quotes-sent chart + header stat ---------- */
  const area = useMemo(() => buildQuoteSeries(quotes, period), [quotes, period])
  const quotesStat = useMemo(() => {
    const total = area.points.reduce((a, b) => a + b, 0)
    let deltaPct = null
    if (period === '7D') {
      const now = Date.now()
      const inWin = (lo, hi) => quotes.filter(q => {
        if (!q.created_at) return false
        const t = new Date(q.created_at).getTime()
        return t >= now - lo * DAY && t < now - hi * DAY
      }).length
      const thisW = inWin(7, 0), lastW = inWin(14, 7)
      if (lastW > 0) deltaPct = Math.round((thisW - lastW) / lastW * 100)
      else if (thisW > 0) deltaPct = 100
    }
    const label = period === '7D' ? 'this week' : period === '30D' ? 'last 30 days' : 'this quarter'
    return { total, deltaPct, label }
  }, [area, quotes, period])

  /* ---------- greeting ---------- */
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = (user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? 'there')
    .split(' ')[0].replace(/^./, c => c.toUpperCase())
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  if (loading) return <div className="muted" style={{ padding: '24px 0' }}>Loading dashboard…</div>

  const kpis = [
    { label: 'New Leads · This Week', icon: ico.userPlus, value: buckets.newLeadsWeek.length, accent: 'cyan',
      delta: leadDelta > 0 ? `▲ ${leadDelta}` : leadDelta < 0 ? `▼ ${Math.abs(leadDelta)}` : '—',
      deltaColor: leadDelta > 0 ? 'var(--cyan)' : 'var(--fg-3)',
      sub: `${buckets.newLeadsMonth.length} this month`, to: '/clients?view=new_lead' },
    { label: 'Active Working Leads', icon: ico.flame, value: buckets.activeWorking.length, accent: 'green',
      sub: 'Working · hot · contract sent', to: '/clients?view=working' },
    { label: 'Ordered · In Project', icon: ico.hardHat, value: buckets.ordered.length, accent: 'purple',
      sub: 'Deposit paid + contract signed', to: '/clients?view=ordered' },
    { label: 'Due Today', icon: ico.calClock, value: dueToday.length, accent: 'orange',
      delta: overdue.length > 0 ? `▲ ${overdue.length} overdue` : null,
      deltaColor: 'var(--amber)',
      sub: 'Follow-ups scheduled', to: '/followups' },
  ]

  const tools = [
    { icon: ico.fileText, name: 'QTE Builder', desc: 'Pricing & quote tool', onClick: () => setBuilding(true) },
    { icon: ico.layout, name: '2D Layout', desc: 'Doors, windows & openings', onClick: () => navigate('/layout') },
  ]

  return (
    <>
      {/* ===== GREETING ===== */}
      <div className="dsh-greet">
        <div>
          <Eyebrow>{dateStr} · Command Center</Eyebrow>
          <h1 className="dsh-h1">{greeting}, <span>{firstName}</span></h1>
          <div className="dsh-status">
            <span><b>{dueToday.length} {dueToday.length === 1 ? 'follow-up' : 'follow-ups'}</b> due today</span>
            {overdue.length > 0 && (
              <>
                <span className="dsh-mid-dot" />
                <span className="dsh-pill-warn"><Icon d={ico.alert} w={13} />{overdue.length} Overdue</span>
              </>
            )}
          </div>
        </div>
        <div className="dsh-actions">
          <Link to="/clients/new" className="dsh-abtn"><Icon d={ico.userPlus} w={15} style={{ color: 'var(--cyan)' }} />Add Lead</Link>
          <button className="dsh-abtn" onClick={() => window.dispatchEvent(new CustomEvent('ss:command-center'))}>
            <Icon d={ico.sparkles} w={15} style={{ color: 'var(--cyan)' }} />Command Center
          </button>
          <button className="dsh-abtn dsh-abtn-primary" onClick={() => setBuilding(true)}>
            <Icon d={ico.plus} w={15} />New Quote
          </button>
        </div>
      </div>

      {/* ===== KPI ROW ===== */}
      <div className="dsh-kpis">
        {kpis.map((k, i) => <KpiCard key={k.label} i={i} {...k} />)}
      </div>

      {/* ===== FOLLOW-UP CALENDAR ===== */}
      <div style={{ marginBottom: 16 }}><DashCalendar /></div>

      {/* ===== BUILD & QUOTE TOOLS ===== */}
      <div className="dsh-section">
        <Eyebrow>Build &amp; Quote Tools</Eyebrow>
        <div className="dsh-tools">
          {tools.map(t => (
            <button key={t.name} className="dsh-tool" onClick={t.onClick}>
              <span className="dsh-tool-ic"><Icon d={t.icon} w={19} /></span>
              <span className="dsh-tool-tx">
                <span className="dsh-tool-name">{t.name}</span>
                <span className="dsh-tool-desc">{t.desc}</span>
              </span>
              <span className="dsh-tool-arrow"><Icon d={ico.arrowR} w={17} /></span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== QUOTES SENT (compact strip) ===== */}
      <div className="dsh-panel dsh-quotes">
        <div className="dsh-quotes-head">
          <div className="dsh-quotes-titles">
            <Eyebrow>Quotes Sent</Eyebrow>
            <div className="dsh-quotes-stat">
              <span className="num">{quotesStat.total}</span>
              <span className="dsh-muted">{quotesStat.label}</span>
              {quotesStat.deltaPct != null && (
                <span className="num" style={{ color: quotesStat.deltaPct >= 0 ? 'var(--cyan)' : 'var(--fg-3)' }}>
                  {quotesStat.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(quotesStat.deltaPct)}%
                </span>
              )}
              {area.peakText && <span className="dsh-muted">· peak {area.peakText}</span>}
            </div>
          </div>
          <div className="seg">
            {['7D', '30D', 'QTR'].map(p => (
              <button key={p} className={p === period ? 'on' : ''} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="dsh-quotes-chart">
          <AreaChart points={area.points} labels={area.labels} peakText={area.peakText} />
        </div>
      </div>

      {/* ===== BOTTOM ROW ===== */}
      <div className="dsh-bottom">
        {/* Active Clients */}
        <div className="dsh-panel dsh-statcard acc-cyan">
          <div className="dsh-panel-title">Active Clients</div>
          <SpecRow label="New Leads · This Week" value={buckets.newLeadsWeek.length} to="/clients?view=new_lead" />
          <SpecRow label="Attempting to Contact" value={buckets.attempting.length} to="/clients?view=contacted" />
          <SpecRow label="Working Leads" value={buckets.working.length} accent to="/clients?view=working" />
          <SpecRow label="Working Hot Leads" value={buckets.hot.length} to="/clients?view=working_hot" />
          <SpecRow label="Contract Sent" value={buckets.contractSent.length} to="/clients?view=contract_sent" />
          <SpecRow label="Dead" value={buckets.dead.length} dim to="/clients?view=dead" last />
        </div>

        {/* Project Stage */}
        <div className="dsh-panel dsh-statcard acc-purple">
          <div className="dsh-panel-title">Project Stage</div>
          {buckets.ordered.length === 0 ? (
            <div className="dsh-muted" style={{ fontSize: 13 }}>No ordered projects yet.</div>
          ) : (
            <div className="dsh-stages">
              {projectBreakdown.map(s => {
                const inner = (
                  <>
                    <div className="dsh-stage-head">
                      <span style={{ color: s.count ? 'var(--fg-2)' : 'var(--fg-3)' }}>{s.label}</span>
                      <span className="num" style={{ color: s.count ? 'var(--cyan)' : 'var(--fg-3)' }}>{s.count}</span>
                    </div>
                    <div className="dsh-stage-track"><div className="dsh-stage-fill" style={{ width: `${Math.round(s.scale * 100)}%` }} /></div>
                  </>
                )
                return s.count > 0
                  ? <Link key={s.value} to={`/clients?view=ordered&stage=${s.value}`} className="dsh-stage dsh-stage-link">{inner}</Link>
                  : <div key={s.value} className="dsh-stage">{inner}</div>
              })}
            </div>
          )}
        </div>

        {/* Follow-Ups Due Today */}
        <div className="dsh-panel dsh-statcard acc-orange">
          <div className="dsh-panel-title dsh-title-row">
            <span>Follow-Ups Due Today</span>
            <Link to="/followups" className="dsh-link">View all</Link>
          </div>
          {dueToday.length === 0 ? (
            <div className="dsh-clear">
              <span className="dsh-clear-ic"><Icon d={ico.check} w={22} /></span>
              <div className="dsh-clear-t">All clear.</div>
              <div className="dsh-clear-s">Nothing due today. Nice work.</div>
            </div>
          ) : (
            <div className="dsh-list">
              {dueToday.map(c => (
                <Link key={c.id} to={`/clients/${c.id}`} className="dsh-li">
                  <span className="num dsh-li-date">{c.follow_up_time ? fmtTime(c.follow_up_time) : 'Today'}</span>
                  <span className="dsh-li-name">{c.name}</span>
                  <span className="dsh-li-tag">{statusLabel(c.status)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Needs Attention */}
        <div className="dsh-panel dsh-statcard acc-orange">
          <div className="dsh-panel-title dsh-title-row">
            <span>Needs Attention</span>
            {(pendingPay.length + overdue.length) > 0 && (
              <span className="dsh-badge-warn num">{pendingPay.length + overdue.length}</span>
            )}
          </div>
          {pendingPay.length === 0 && overdue.length === 0 ? (
            <div className="dsh-muted" style={{ fontSize: 13 }}>Nothing needs attention. Nice.</div>
          ) : (
            <div className="dsh-attn-list">
              {pendingPay.map(c => (
                <Link key={'pay-' + c.id} to={`/clients/${c.id}`} className="dsh-attn">
                  <span className="num dsh-attn-date">PENDING</span>
                  <span className="dsh-attn-name">{c.name}</span>
                  <span className="dsh-attn-tag">Payment not cleared</span>
                </Link>
              ))}
              {overdue.map(c => (
                <Link key={c.id} to={`/clients/${c.id}`} className="dsh-attn">
                  <span className="num dsh-attn-date">{fmtDate(c.follow_up_date)}</span>
                  <span className="dsh-attn-name">{c.name}</span>
                  <span className="dsh-attn-tag">{statusLabel(c.status)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {building && <BuildQuoteModal client={null} onClose={() => setBuilding(false)} />}
    </>
  )
}

/* ---------- KPI card ---------- */
function KpiCard({ i, label, value, delta, deltaColor, sub, icon, to, accent = 'cyan' }) {
  const display = useCountUp(value)
  const cls = `dsh-kpi acc-${accent}`
  const content = (
    <>
      <div className="dsh-kpi-head">
        <span className="dsh-kpi-label">{label}</span>
        <span className="dsh-kpi-ic"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg></span>
      </div>
      <div className="dsh-kpi-val-row">
        <span className="dsh-kpi-val num">{Math.round(display).toLocaleString()}</span>
        {delta && <span className="dsh-kpi-delta num" style={{ color: deltaColor }}>{delta}</span>}
      </div>
      <div className="dsh-kpi-sub">{sub}</div>
    </>
  )
  return to
    ? <Link to={to} className={cls} style={{ '--i': i }}>{content}</Link>
    : <div className={cls} style={{ '--i': i }}>{content}</div>
}

/* ---------- spec-table row (Active Clients) ---------- */
function SpecRow({ label, value, accent, dim, to, last }) {
  const inner = (
    <>
      <span className="dsh-spec-lbl" style={dim ? { color: 'var(--fg-3)' } : undefined}>{label}</span>
      <span className="dsh-spec-val num" style={{ color: dim ? 'var(--fg-3)' : accent ? 'var(--cyan)' : 'var(--fg)' }}>{value}</span>
    </>
  )
  const cls = `dsh-spec${last ? ' last' : ''}`
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
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
