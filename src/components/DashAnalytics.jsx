// Dashboard → Sales Analytics. Pure read-only roll-ups of live Supabase data
// (clients + quotes + users) — no new tables. Period + rep filters are local UI
// state. Everything is derived client-side so it always matches the pipeline.
//
// Definitions (kept simple + stated in the UI):
//   • Lead            = client row created in the period
//   • Quote           = quote row created in the period
//   • Order           = client with status 'ordered' whose order_date (fallback
//                       updated_at) falls in the period
//   • Order value     = that client's most recent quote total
//   • Close rate      = orders ÷ new leads in the same period
//   • Rep             = client.primary_rep (quotes: created_by)

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CLIENT_STATUSES, DEAD_STATUSES, sourceLabel } from '../lib/constants'

const DAY = 86400000
const PERIODS = [
  { key: '30D', label: '30 Days' },
  { key: '90D', label: '90 Days' },
  { key: 'YTD', label: 'Year to Date' },
  { key: '12M', label: '12 Months' },
  { key: 'ALL', label: 'All Time' },
]
const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—')
const ts = (v) => (v ? new Date(v).getTime() : NaN)

function periodStart(key) {
  const now = new Date()
  if (key === '30D') return Date.now() - 30 * DAY
  if (key === '90D') return Date.now() - 90 * DAY
  if (key === 'YTD') return new Date(now.getFullYear(), 0, 1).getTime()
  if (key === '12M') return Date.now() - 365 * DAY
  return 0
}

export default function DashAnalytics({ clients, quotes }) {
  const [period, setPeriod] = useState('90D')
  const [rep, setRep] = useState('all')
  const [users, setUsers] = useState([])

  useEffect(() => {
    supabase.from('users').select('id, display_name').then(({ data }) => setUsers(data ?? []))
  }, [])
  const repName = (id) => users.find((u) => u.id === id)?.display_name || 'Unassigned'

  const d = useMemo(() => {
    const from = periodStart(period)
    const inP = (t) => Number.isFinite(t) && t >= from
    const repOk = (id) => rep === 'all' || id === rep

    // latest quote per client → order value
    const latestQ = {}
    for (const q of quotes) {
      if (q.status === 'superseded') continue // replaced by a revised order: never the current quote
      const cur = latestQ[q.client_id]
      if (!cur || ts(q.created_at) > ts(cur.created_at)) latestQ[q.client_id] = q
    }
    const orderT = (c) => ts(c.order_date || c.updated_at)
    const valueOf = (c) => Number(latestQ[c.id]?.total_amount) || 0

    const scoped = clients.filter((c) => repOk(c.primary_rep))
    const leads = scoped.filter((c) => inP(ts(c.created_at)))
    const orders = scoped.filter((c) => c.status === 'ordered' && inP(orderT(c)))
    const qs = quotes.filter((q) => inP(ts(q.created_at)) && (rep === 'all' || q.created_by === rep))
    const volume = orders.reduce((s, c) => s + valueOf(c), 0)
    const quotedLeadIds = new Set(quotes.map((q) => q.client_id))
    const leadsQuoted = leads.filter((c) => quotedLeadIds.has(c.id)).length
    const days = orders
      .map((c) => (orderT(c) - ts(c.created_at)) / DAY)
      .filter((x) => Number.isFinite(x) && x >= 0)
    const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
    const dead = leads.filter((c) => DEAD_STATUSES.includes(c.status)).length

    // trend buckets: weekly for ≤90 days, monthly otherwise
    const weekly = period === '30D' || period === '90D'
    let start = from
    if (!weekly) {
      const all = scoped.map((c) => ts(c.created_at)).filter(Number.isFinite)
      const first = period === 'ALL' ? (all.length ? Math.min(...all) : Date.now()) : from
      const f = new Date(first); start = new Date(f.getFullYear(), f.getMonth(), 1).getTime()
    }
    const buckets = []
    if (weekly) {
      for (let t = start; t < Date.now(); t += 7 * DAY) buckets.push({ lo: t, hi: t + 7 * DAY, label: new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) })
    } else {
      const s = new Date(start)
      for (let i = 0; ; i++) {
        const lo = new Date(s.getFullYear(), s.getMonth() + i, 1).getTime()
        if (lo > Date.now()) break
        buckets.push({ lo, hi: new Date(s.getFullYear(), s.getMonth() + i + 1, 1).getTime(), label: new Date(lo).toLocaleDateString(undefined, { month: 'short' }) })
      }
    }
    const trend = buckets.slice(-18).map((b) => ({
      label: b.label,
      leads: leads.filter((c) => ts(c.created_at) >= b.lo && ts(c.created_at) < b.hi).length,
      orders: orders.filter((c) => orderT(c) >= b.lo && orderT(c) < b.hi).length,
    }))

    // current pipeline snapshot (not period-bound)
    const funnel = CLIENT_STATUSES.map((s) => ({
      label: s.label,
      value: s.value,
      n: scoped.filter((c) => (s.value === 'working' ? ['working', 'quoted', 'follow_up'].includes(c.status)
        : s.value === 'dead' ? DEAD_STATUSES.includes(c.status) : c.status === s.value)).length,
    }))

    // sources
    const srcMap = {}
    for (const c of leads) {
      const k = c.source || 'unknown'
      srcMap[k] ??= { key: k, leads: 0, orders: 0, volume: 0 }
      srcMap[k].leads++
    }
    for (const c of orders) {
      const k = c.source || 'unknown'
      srcMap[k] ??= { key: k, leads: 0, orders: 0, volume: 0 }
      srcMap[k].orders++; srcMap[k].volume += valueOf(c)
    }
    const sources = Object.values(srcMap).sort((a, b) => b.leads - a.leads || b.orders - a.orders)

    // reps (always all reps — the scoreboard compares them)
    const repIds = new Set([...clients.map((c) => c.primary_rep), ...quotes.map((q) => q.created_by)].filter(Boolean))
    const reps = [...repIds].map((id) => {
      const L = clients.filter((c) => c.primary_rep === id && inP(ts(c.created_at))).length
      const O = clients.filter((c) => c.primary_rep === id && c.status === 'ordered' && inP(orderT(c)))
      return {
        id, leads: L,
        quotes: quotes.filter((q) => q.created_by === id && inP(ts(q.created_at))).length,
        orders: O.length, volume: O.reduce((s, c) => s + valueOf(c), 0),
      }
    }).filter((r) => r.leads || r.quotes || r.orders).sort((a, b) => b.volume - a.volume || b.orders - a.orders)

    // manufacturer + county
    const mfr = {}
    for (const c of orders) { const k = c.order_mfr || latestQ[c.id]?.manufacturer || 'Unknown'; mfr[k] = (mfr[k] || 0) + 1 }
    const cty = {}
    for (const c of leads) { const k = c.county || '—'; cty[k] ??= { leads: 0, orders: 0 }; cty[k].leads++ }
    for (const c of orders) { const k = c.county || '—'; cty[k] ??= { leads: 0, orders: 0 }; cty[k].orders++ }
    const counties = Object.entries(cty).filter(([k]) => k !== '—').sort((a, b) => b[1].leads - a[1].leads).slice(0, 8)

    return {
      leads: leads.length, quotes: qs.length, orders: orders.length, volume,
      avgOrder: orders.length ? volume / orders.length : 0, avgDays, leadsQuoted, dead,
      trend, funnel, sources, reps, mfr: Object.entries(mfr).sort((a, b) => b[1] - a[1]), counties,
    }
  }, [clients, quotes, period, rep])

  const repOptions = useMemo(() => {
    const ids = new Set(clients.map((c) => c.primary_rep).filter(Boolean))
    return [...ids].map((id) => ({ id, name: repName(id) })).sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, users]) // eslint-disable-line react-hooks/exhaustive-deps

  const funnelMax = Math.max(1, ...d.funnel.map((f) => f.n))
  const trendMax = Math.max(1, ...d.trend.map((t) => Math.max(t.leads, t.orders)))
  const mfrTotal = d.mfr.reduce((s, [, n]) => s + n, 0)

  return (
    <div className="dsh-section ana">
      <div className="ana-head">
        <div className="dsh-eyebrow"><span className="dsh-bar" />Sales Analytics</div>
        <div className="ana-filters">
          <select className="ana-select" value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Filter by rep">
            <option value="all">All reps</option>
            {repOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="ana-seg" role="tablist" aria-label="Date range">
            {PERIODS.map((p) => (
              <button key={p.key} className={p.key === period ? 'on' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="ana-kpis">
        <Kpi label="New Leads" value={d.leads} />
        <Kpi label="Quotes Built" value={d.quotes} sub={`${pct(d.leadsQuoted, d.leads)} of new leads quoted`} />
        <Kpi label="Orders" value={d.orders} accent="lime" />
        <Kpi label="Sales Volume" value={money(d.volume)} accent="lime" sub="Sum of ordered clients' latest quote" />
        <Kpi label="Avg Order" value={d.orders ? money(d.avgOrder) : '—'} />
        <Kpi label="Close Rate" value={pct(d.orders, d.leads)} sub="Orders ÷ new leads" accent="cyan" />
        <Kpi label="Lead → Order" value={d.avgDays == null ? '—' : `${d.avgDays} days`} sub="Average time to close" />
        <Kpi label="Went Dead" value={d.dead} sub={`${pct(d.dead, d.leads)} of new leads`} accent="amber" />
      </div>

      <div className="ana-grid">
        <div className="dsh-panel ana-wide">
          <div className="dsh-panel-title">Leads vs Orders</div>
          <div className="ana-legend"><span className="lg-leads" />Leads<span className="lg-orders" />Orders</div>
          {d.trend.length === 0 ? <div className="ana-empty">No data in this range.</div> : (
            <div className="ana-bars" style={{ '--n': d.trend.length }}>
              {d.trend.map((t, i) => (
                <div key={i} className="ana-bar-col" title={`${t.label}: ${t.leads} leads, ${t.orders} orders`}>
                  <div className="ana-bar-pair">
                    <div className="ana-bar leads" style={{ height: `${(t.leads / trendMax) * 100}%` }}>{t.leads > 0 && <span>{t.leads}</span>}</div>
                    <div className="ana-bar orders" style={{ height: `${(t.orders / trendMax) * 100}%` }}>{t.orders > 0 && <span>{t.orders}</span>}</div>
                  </div>
                  <div className="ana-bar-lbl">{t.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dsh-panel">
          <div className="dsh-panel-title">Pipeline Right Now</div>
          {d.funnel.map((f) => (
            <div key={f.value} className="ana-hbar">
              <span className="ana-hbar-lbl">{f.label}</span>
              <span className="ana-hbar-track"><span className={`ana-hbar-fill ${f.value === 'ordered' ? 'lime' : f.value === 'dead' ? 'dim' : ''}`} style={{ width: `${(f.n / funnelMax) * 100}%` }} /></span>
              <span className="ana-hbar-n num">{f.n}</span>
            </div>
          ))}
        </div>

        <div className="dsh-panel">
          <div className="dsh-panel-title">Rep Scoreboard</div>
          <table className="ana-table">
            <thead><tr><th>Rep</th><th>Leads</th><th>Quotes</th><th>Orders</th><th>Close</th><th>Volume</th></tr></thead>
            <tbody>
              {d.reps.length === 0 && <tr><td colSpan={6} className="ana-empty">No activity in this range.</td></tr>}
              {d.reps.map((r) => (
                <tr key={r.id}><td>{repName(r.id)}</td><td className="num">{r.leads}</td><td className="num">{r.quotes}</td><td className="num">{r.orders}</td><td className="num">{pct(r.orders, r.leads)}</td><td className="num">{money(r.volume)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dsh-panel">
          <div className="dsh-panel-title">Lead Sources</div>
          <table className="ana-table">
            <thead><tr><th>Source</th><th>Leads</th><th>Orders</th><th>Close</th><th>Volume</th></tr></thead>
            <tbody>
              {d.sources.length === 0 && <tr><td colSpan={5} className="ana-empty">No leads in this range.</td></tr>}
              {d.sources.map((s) => (
                <tr key={s.key}><td>{s.key === 'unknown' ? 'Not set' : sourceLabel(s.key)}</td><td className="num">{s.leads}</td><td className="num">{s.orders}</td><td className="num">{pct(s.orders, s.leads)}</td><td className="num">{money(s.volume)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dsh-panel">
          <div className="dsh-panel-title">Orders by Manufacturer</div>
          {d.mfr.length === 0 ? <div className="ana-empty">No orders in this range.</div> : d.mfr.map(([k, n]) => (
            <div key={k} className="ana-hbar">
              <span className="ana-hbar-lbl">{k}</span>
              <span className="ana-hbar-track"><span className="ana-hbar-fill lime" style={{ width: `${(n / mfrTotal) * 100}%` }} /></span>
              <span className="ana-hbar-n num">{n} · {pct(n, mfrTotal)}</span>
            </div>
          ))}
        </div>

        <div className="dsh-panel">
          <div className="dsh-panel-title">Top Counties</div>
          <table className="ana-table">
            <thead><tr><th>County</th><th>Leads</th><th>Orders</th><th>Close</th></tr></thead>
            <tbody>
              {d.counties.length === 0 && <tr><td colSpan={4} className="ana-empty">No county data in this range.</td></tr>}
              {d.counties.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="num">{v.leads}</td><td className="num">{v.orders}</td><td className="num">{pct(v.orders, v.leads)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`ana-kpi${accent ? ' acc-' + accent : ''}`}>
      <div className="ana-kpi-lbl">{label}</div>
      <div className="ana-kpi-val num">{value}</div>
      {sub && <div className="ana-kpi-sub">{sub}</div>}
    </div>
  )
}
