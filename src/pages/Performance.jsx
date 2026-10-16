// Performance: how the business is ACTUALLY doing, by week / month / 3 months / any dates
// (owner 10/16/26, modeled on the MBHQ weekly report). Owner + Joshua only (useIsAdmin).
// Numbers: src/lib/perfStats.js (unit-tested). Rows: src/lib/perfLoad.js (paged; a short read is an
// error, never a smaller number). Print: src/lib/perfReportHtml.js (a light Letter document).

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadPerformance } from '../lib/perfLoad'
import { computePerformance, nyDay, PERIODS, periodFor, dayLabel } from '../lib/perfStats'
import { buildPerformanceHtml } from '../lib/perfReportHtml'
import { renderQuotePdf } from '../lib/builderSave'
import { LEAD_SOURCES } from '../lib/constants'
import { usd } from '../lib/money'
import { useIsAdmin } from '../lib/useIsAdmin'
import { toast } from '../lib/uiFx'

const sourceLabel = (v) => (v ? LEAD_SOURCES.find((s) => s.value === v)?.label || v : 'Not recorded')
const pctText = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const money = (n) => (n == null ? '—' : usd(n) || '$0')
const hoursText = (h) => (h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(1)} hrs` : `${(h / 24).toFixed(1)} days`)
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={`ana-kpi${accent ? ' acc-' + accent : ''}`}>
      <div className="ana-kpi-lbl">{label}</div>
      <div className="ana-kpi-val num">{value}</div>
      {sub ? <div className="ana-kpi-sub">{sub}</div> : null}
    </div>
  )
}

function Panel({ title, right, children }) {
  return (
    <section className="dsh-panel perf-panel">
      <div className="perf-panel-head">
        <div className="dsh-panel-title">{title}</div>
        {right ? <div style={MUTED}>{right}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A short list of leads (links), with "+N more". */
function LeadList({ items, max = 8, render }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, max)
  return (
    <span>
      {shown.map((x, i) => (
        <span key={x.id || i}>
          {i ? ', ' : ''}
          {x.id ? <Link to={`/clients/${x.id}`}>{x.name || 'Unnamed'}</Link> : (x.name || 'Unnamed')}
          {render ? render(x) : null}
        </span>
      ))}
      {items.length > max && !all ? <> · <button type="button" className="perf-linkbtn" onClick={() => setAll(true)}>+{items.length - max} more</button></> : null}
    </span>
  )
}

export function summaryLines(r) {
  const m = r.main
  const p = r.period
  const when = p.key === 'this_week' ? 'so far this week'
    : p.key === 'last_week' ? 'last week'
    : p.key === 'custom' ? `from ${p.range}`
    : `in ${p.label.toLowerCase()}`
  const avg = r.prevAvgLeads == null ? ''
    : p.key === 'this_week' ? `; the same days of the five weeks before averaged ${r.prevAvgLeads.toFixed(1)}`
    : `; the five weeks before averaged ${r.prevAvgLeads.toFixed(1)} a week`
  const out = []
  out.push(`${m.leadsIn} new lead${m.leadsIn === 1 ? '' : 's'} came in ${when}${avg}.`)
  if (r.handling.leads) out.push(`${pctText(r.handling.followedPct)} were followed up by a rep (${r.handling.followed} of ${r.handling.leads})${r.handling.medianHours != null ? `, with a median of ${hoursText(r.handling.medianHours)} to the first follow-up` : ''}.`)
  out.push(`${m.customersQuoted} customer${m.customersQuoted === 1 ? ' was' : 's were'} quoted, worth ${money(m.quotedValue)} (quote totals, sales tax included).`)
  out.push(`${m.sold} building${m.sold === 1 ? ' was' : 's were'} marked Ordered, worth ${money(m.soldValue)}${m.soldNoAmount ? ` (${m.soldNoAmount} with no priced quote on file)` : ''}.`)
  out.push(!r.tracked ? 'Deposits are not tracked yet (the one-time database update adds them).'
    : m.deposits == null ? `Deposits are counted from ${dayLabel(r.depositsSince, true)}, after this period.`
    : `${money(m.deposits)} in deposits came in (${m.depositCount} deposit${m.depositCount === 1 ? '' : 's'}).`)
  out.push(`The open pipeline holds ${r.openTotal} lead${r.openTotal === 1 ? '' : 's'}; ${r.ages.d30} came in during the last 30 days.`)
  if (r.checks.noSource) out.push(`${r.checks.noSource} of this period's ${m.leadsIn} leads have no source entered.`)
  return out
}

export default function Performance() {
  const [accessTick, setAccessTick] = useState(0)
  const admin = useIsAdmin(accessTick)
  const [params, setParams] = useSearchParams()
  const today = nyDay(Date.now())
  const key = PERIODS.some((x) => x.key === params.get('p')) ? params.get('p') : 'this_week'
  const period = useMemo(() => periodFor(key, today, { from: params.get('from'), to: params.get('to') }), [key, today, params])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (admin !== true) return undefined
    let alive = true
    setBusy(true)
    loadPerformance(supabase).then((r) => {
      if (!alive) return
      setBusy(false)
      if (r.error) { setError(r.error); return } // a failed reload keeps what is on screen
      setError('')
      setData(r.data)
      setLoadedAt(Date.now())
    })
    return () => { alive = false }
  }, [admin, reload])

  const result = useMemo(() => (data ? computePerformance(data, period, { today, now: loadedAt || Date.now() }) : null), [data, period, today, loadedAt])

  const setPeriod = (k) => {
    if (k === 'custom') setParams({ p: 'custom', from: period.from, to: period.to })
    else setParams(k === 'this_week' ? {} : { p: k })
  }

  async function printReport() {
    if (!result) return
    setPrinting(true)
    const clean = (s) => String(s || '').replace(/[<>&]/g, '')
    try {
      const html = buildPerformanceHtml(result, { summary: summaryLines(result), sourceLabel })
      const name = `StormSafe Performance ${result.period.from} to ${result.period.to}.pdf`
      const api = typeof window !== 'undefined' ? window.electronAPI : null
      if (api && typeof api.savePdf === 'function') {
        const res = await api.savePdf(html, name) // { ok } / { ok:false, canceled } / { ok:false, error }
        if (res && res.ok === false && !res.canceled) toast(`Could not save the report: ${clean(res.error)}`)
      } else {
        const blob = await renderQuotePdf(html)
        const url = URL.createObjectURL(blob)
        if (!window.open(url, '_blank')) {
          // pop-up blocked: download it instead
          const a = document.createElement('a')
          a.href = url
          a.download = name
          document.body.appendChild(a)
          a.click()
          a.remove()
        }
      }
    } catch (e) {
      toast(`Could not make the report: ${clean(e?.message || e)}`)
    } finally {
      setPrinting(false)
    }
  }

  if (admin === null) return <div className="muted" style={{ padding: 24 }}>Loading…</div>
  if (admin === 'error') {
    return (
      <div className="page-head"><div className="left">
        <h1>Performance</h1>
        <div className="sub">Could not check your access just now. <button type="button" className="btn-secondary" onClick={() => setAccessTick((n) => n + 1)}>Try again</button></div>
      </div></div>
    )
  }
  if (!admin) {
    return (
      <div className="page-head"><div className="left">
        <div className="eyebrow-lime">Owner only</div>
        <h1>Performance</h1>
        <div className="sub">
          This page is for the owner and Joshua. If that is you, the login needs to be made an admin first (ask Claude).{' '}
          <button type="button" className="btn-secondary" onClick={() => setAccessTick((n) => n + 1)}>Check again</button>
        </div>
      </div></div>
    )
  }

  const r = result
  return (
    <div className="perf">
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Owner + Joshua only</div>
          <h1>Performance</h1>
          <div className="sub">
            {period.label} · {period.range}{period.toDate ? ' (to date)' : ''}
            {loadedAt ? <> · numbers as of {new Date(loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</> : null}
          </div>
        </div>
        <div className="right">
          <button type="button" className="btn-secondary" onClick={() => setReload((n) => n + 1)} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
          <button type="button" className="btn-primary" onClick={printReport} disabled={!r || printing}>{printing ? 'Making the report…' : 'Print report'}</button>
        </div>
      </div>

      <div className="list-tabs perf-periods" style={{ marginBottom: 10 }}>
        {PERIODS.map((x) => (
          <button key={x.key} type="button" className={`list-tab${key === x.key ? ' on' : ''}`} onClick={() => setPeriod(x.key)}
            style={key === x.key ? { background: 'rgba(34,211,200,.12)', borderColor: 'rgba(34,211,200,.45)' } : undefined}>
            {x.label}
          </button>
        ))}
      </div>
      {key === 'custom' ? <CustomDates period={period} today={today} onApply={(from, to) => setParams({ p: 'custom', from, to })} /> : null}

      {error ? <div className="error-banner">{error}{data ? ' The numbers below are from the last good read.' : ''}</div> : null}
      {!r ? (busy ? <div className="muted" style={{ padding: 20 }}>Reading the CRM…</div> : null) : (
        <>
          <Panel title="Summary">
            <ul className="perf-summary">{summaryLines(r).map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Panel>

          <div className="ana-kpis perf-kpis">
            <Kpi label="Leads in" value={r.main.leadsIn} sub="by the day they came in" accent="cyan" />
            <Kpi label="Customers quoted" value={r.main.customersQuoted} sub={`${r.main.quotesMade} quote${r.main.quotesMade === 1 ? '' : 's'} saved${r.main.revisions ? `, ${r.main.revisions} revision${r.main.revisions === 1 ? '' : 's'}` : ''}`} />
            <Kpi label="Quoted value" value={money(r.main.quotedValue)} sub="latest quote per customer, with tax" />
            <Kpi label="Buildings sold" value={r.main.sold} sub="marked Ordered (order date)" accent="lime" />
            <Kpi label="$ sold" value={money(r.main.soldValue)} sub={r.main.soldNoAmount ? `${r.main.soldNoAmount} sold with no priced quote` : 'quote totals, with tax'} accent="lime" />
            <Kpi
              label="Deposits received"
              value={!r.tracked ? 'Not tracked yet' : r.main.deposits == null ? 'n/a' : money(r.main.deposits)}
              sub={!r.tracked ? 'needs the one-time update' : r.main.deposits == null ? `counted from ${dayLabel(r.depositsSince, true)}` : `${r.main.depositCount} deposit${r.main.depositCount === 1 ? '' : 's'} · counted from ${dayLabel(r.depositsSince)}`}
              accent="amber"
            />
            <Kpi label="Close rate" value={pctText(r.closeRate.pct)} sub={`${r.closeRate.ordered} of this period's ${r.closeRate.of} leads are Ordered now`} />
            <Kpi label="Average deal" value={money(r.main.avgDeal == null ? null : Math.round(r.main.avgDeal))} sub={`${r.main.lost} lead${r.main.lost === 1 ? '' : 's'} marked Dead this period`} />
          </div>

          <Panel title={r.period.grain === 'week' ? 'Six-week trend' : 'By month'}>
            <TrendTable r={r} />
          </Panel>

          <Panel title="By sales rep" right="the lead's rep · open leads and quiet leads are as of now">
            <RepTable r={r} />
          </Panel>

          <div className="ana-grid perf-grid">
            <Panel title="Where new leads came from" right={`${r.main.leadsIn} lead${r.main.leadsIn === 1 ? '' : 's'}`}>
              <table className="ana-table">
                <thead><tr><th>Source</th><th>Leads</th><th>Share</th><th>Quoted</th><th>Ordered</th></tr></thead>
                <tbody>
                  {r.sources.length === 0 ? <tr><td colSpan={5} className="ana-empty">No new leads in this period.</td></tr> : r.sources.map((s) => (
                    <tr key={s.source || 'none'}>
                      <td>{sourceLabel(s.source)}</td>
                      <td className="num">{s.leads}</td>
                      <td className="num">{pctText(s.leads / (r.main.leadsIn || 1))}</td>
                      <td className="num">{s.quoted}</td>
                      <td className="num">{s.ordered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="How new leads were handled" right="a follow-up = a call, email, meeting or note a rep logged">
              <div className="perf-mini">
                <div><b className="num">{pctText(r.handling.followedPct)}</b><span>followed up · {r.handling.followed} of {r.handling.leads}</span></div>
                <div><b className="num">{hoursText(r.handling.medianHours)}</b><span>median time to the first follow-up</span></div>
                <div><b className="num">{pctText(r.handling.within24Pct)}</b><span>of those within 24 hours</span></div>
              </div>
              {r.handling.untimed ? <div style={{ ...MUTED, marginTop: 8 }}>{r.handling.untimed} lead{r.handling.untimed === 1 ? ' was' : 's were'} entered after {r.handling.untimed === 1 ? 'its' : 'their'} first-contact day, so the wait cannot be timed (not in the median).</div> : null}
            </Panel>
          </div>

          <Panel title="Buildings sold this period" right={r.tracked ? null : 'deposits: not tracked yet'}>
            {r.deals.length === 0 ? <div className="ana-empty">No leads marked Ordered with an order date in this period.</div> : (
              <table className="ana-table">
                <thead><tr><th>Lead</th><th>Rep</th><th>Order date</th><th>Amount</th><th>Deposits on file (all dates)</th></tr></thead>
                <tbody>
                  {r.deals.map((d) => (
                    <tr key={d.id}>
                      <td><Link to={`/clients/${d.id}`}>{d.name}</Link></td>
                      <td>{d.rep}</td>
                      <td className="num">{d.orderDay ? dayLabel(d.orderDay, true) : '—'}</td>
                      <td className="num" title={d.amountFrom === 'sold' ? 'the quote marked sold' : d.amountFrom === 'starred' ? 'no quote marked sold: the starred quote' : d.amountFrom === 'newest' ? 'no quote marked sold: the newest quote' : d.amountFrom === 'sold-unpriced' ? 'the quote marked sold has no price' : 'no priced quote'}>
                        {money(d.amount)}{d.amountFrom === 'starred' || d.amountFrom === 'newest' ? ' *' : ''}{d.multiSold ? ' †' : ''}
                      </td>
                      <td className="num">{r.tracked ? (d.depositAll ? money(d.depositAll) : '—') : 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {r.deals.some((d) => d.amountFrom === 'starred' || d.amountFrom === 'newest') ? <div style={{ ...MUTED, marginTop: 8 }}>* No quote marked sold on that lead: the amount is its starred (or newest) quote.</div> : null}
            {r.deals.some((d) => d.multiSold) ? <div style={{ ...MUTED, marginTop: 4 }}>† More than one quote on that lead is marked sold: the amount is the newest Deposit Paid / Revised Order one.</div> : null}
          </Panel>

          {r.tracked ? (
            <Panel title="Deposits received this period" right={r.main.deposits == null ? `counted from ${dayLabel(r.depositsSince, true)}` : money(r.main.deposits)}>
              {r.depositRows.length === 0 ? <div className="ana-empty">No deposits received in this period.</div> : (
                <table className="ana-table">
                  <thead><tr><th>Lead</th><th>Received</th><th>Paid by</th><th>Amount</th></tr></thead>
                  <tbody>
                    {r.depositRows.map((x) => (
                      <tr key={x.id}>
                        <td><Link to={`/clients/${x.clientId}`}>{x.name}</Link></td>
                        <td className="num">{x.day ? dayLabel(x.day, true) : '—'}</td>
                        <td>{x.method || '—'}</td>
                        <td className="num">{money(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ) : null}

          <Panel title="Open pipeline right now" right={`${r.openTotal} open lead${r.openTotal === 1 ? '' : 's'}`}>
            <div className="perf-bars">
              {r.pipeline.map((s) => (
                <div className="perf-bar" key={s.key}>
                  <span className="perf-bar-lbl">{s.label}</span>
                  <span className="perf-bar-track"><span style={{ width: `${r.openTotal ? (s.count / Math.max(...r.pipeline.map((x) => x.count), 1)) * 100 : 0}%` }} /></span>
                  <b className="num">{s.count}</b>
                </div>
              ))}
            </div>
            <div className="perf-mini" style={{ marginTop: 12 }}>
              <div><b className="num">{r.ages.d30}</b><span>came in, last 30 days</span></div>
              <div><b className="num">{r.ages.d90}</b><span>31 – 90 days ago</span></div>
              <div><b className="num">{r.ages.d180}</b><span>91 – 180 days ago</span></div>
              <div><b className="num">{r.ages.older}</b><span>over 180 days ago</span></div>
            </div>
          </Panel>

          <Checks r={r} />

          <Panel title="How these are counted">
            <ul className="perf-notes">
              <li>Days are New York calendar days; weeks run Monday to Sunday. A lead counts on the day it came in (its first-contact date, else the day it was entered).</li>
              <li>Sold = the lead was marked Ordered; it counts on its order date. The amount is the lead's quote marked sold (Deposit Paid / Revised Order first, else Verbal Accept), sales tax included. "Pending Deposit" leads are not marked Ordered, so they count as open here.</li>
              <li>Quoted = a quote saved with a price (unfinished quotes with no price are not counted); quoted value uses each customer's latest quote in the period.</li>
              <li>Deposits = the "Deposit received" entries on the order screen, by the day the money came in{r.tracked && r.depositsSince ? `, counted from ${dayLabel(r.depositsSince, true)} (when tracking started; earlier weeks show n/a)` : ''}.</li>
              <li>The trend rows are whole weeks / months; the highlighted rows are inside the period.</li>
              <li>Left out: leads in the Trash, the sample leads, and leads with the word "test" in the name ({r.checks.testLeads.length} now). Reps with the same name on two logins are one person.</li>
              <li>A follow-up is a call, email, meeting or note a rep logged; automatic entries (stage changes, quote saves, design-link notes) are not. "No activity 14+ days" = open leads with no follow-up logged in 14 days.</li>
            </ul>
          </Panel>
        </>
      )}
    </div>
  )
}

/**
 * Custom From / To: typed into freely (a date box changes on every digit), applied with the button or
 * Enter once both are whole dates; never swapped behind the person's back.
 */
function CustomDates({ period, today, onApply }) {
  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState(period.to)
  useEffect(() => { setFrom(period.from); setTo(period.to) }, [period.from, period.to])
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' && d <= today
  const err = !ok(from) || !ok(to) ? 'Pick both dates (up to today).' : from > to ? '"From" is after "To".' : ''
  const apply = () => { if (!err && (from !== period.from || to !== period.to)) onApply(from, to) }
  const onKey = (e) => { if (e.key === 'Enter') apply() }
  return (
    <div className="perf-custom">
      <label>From <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} onKeyDown={onKey} /></label>
      <label>To <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} onKeyDown={onKey} /></label>
      <button type="button" className="btn-secondary" onClick={apply} disabled={!!err || (from === period.from && to === period.to)}>Show these dates</button>
      {err ? <span style={{ color: 'var(--warning, #f0883e)' }}>{err}</span> : null}
    </div>
  )
}

function TrendTable({ r }) {
  const max = Math.max(1, ...r.trend.map((b) => b.leadsIn))
  return (
    <table className="ana-table perf-trend">
      <thead><tr><th>{r.period.grain === 'week' ? 'Week' : 'Month'}</th><th>Leads in</th><th>Customers quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th></tr></thead>
      <tbody>
        {r.trend.map((b) => {
          return (
            <tr key={b.from} className={b.inPeriod ? 'perf-cur' : ''}>
              <td>
                {b.label}
                {b.partial ? <span style={MUTED}> · to {dayLabel(b.upTo)}</span> : null}
                {b.startsBefore ? <span style={MUTED}> · the period starts {dayLabel(r.period.from)}</span> : null}
              </td>
              <td className="num"><span className="perf-inline-bar" style={{ width: `${(b.leadsIn / max) * 48}px` }} />{b.leadsIn}</td>
              <td className="num">{b.customersQuoted}</td>
              <td className="num">{money(b.quotedValue)}</td>
              <td className="num">{b.sold}</td>
              <td className="num">{money(b.soldValue)}</td>
              <td className="num">{b.deposits == null ? 'n/a' : money(b.deposits)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RepTable({ r }) {
  return (
    <div className="perf-scroll">
      <table className="ana-table">
        <thead>
          <tr><th>Rep</th><th>Open leads</th><th>New leads</th><th>Follow-ups logged</th><th>Customers quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th><th>No activity 14+ days</th></tr>
        </thead>
        <tbody>
          {r.reps.map((x) => (
            <tr key={x.key}>
              <td>{x.name}</td>
              <td className="num">{x.openNow}</td>
              <td className="num">{x.newLeads}</td>
              <td className="num">{x.followUps}</td>
              <td className="num">{x.customersQuoted}</td>
              <td className="num">{x.quotedValue ? money(x.quotedValue) : '—'}</td>
              <td className="num">{x.sold}</td>
              <td className="num">{x.soldValue ? money(x.soldValue) : '—'}</td>
              <td className="num">{r.tracked ? (x.deposits ? money(x.deposits) : '—') : 'n/a'}</td>
              <td className="num" style={x.quiet ? { color: 'var(--danger, #f87171)' } : undefined}>{x.quiet}</td>
            </tr>
          ))}
          <tr className="perf-total">
            <td>Total</td>
            <td className="num">{r.totals.openNow}</td>
            <td className="num">{r.totals.newLeads}</td>
            <td className="num">{r.totals.followUps}</td>
            <td className="num">{r.totals.customersQuoted}</td>
            <td className="num">{money(r.totals.quotedValue)}</td>
            <td className="num">{r.totals.sold}</td>
            <td className="num">{money(r.totals.soldValue)}</td>
            <td className="num">{r.tracked ? money(r.totals.deposits) : 'n/a'}</td>
            <td className="num">{r.totals.quiet}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Checks({ r }) {
  const c = r.checks
  const items = [
    c.orderedNoDate.length ? { k: 'od', text: `${c.orderedNoDate.length} lead${c.orderedNoDate.length === 1 ? ' is' : 's are'} marked Ordered with no order date, so not counted as sold anywhere. Open the lead → Edit Order → set the date:`, list: c.orderedNoDate } : null,
    c.soldQuoteNotOrdered.length ? { k: 'sq', text: `${c.soldQuoteNotOrdered.length} lead${c.soldQuoteNotOrdered.length === 1 ? ' has' : 's have'} a quote marked Deposit Paid / Revised Order but the lead is not marked Ordered (a missed order?):`, list: c.soldQuoteNotOrdered } : null,
    c.soldFromOther.length ? { k: 'sf', text: `${c.soldFromOther.length} building${c.soldFromOther.length === 1 ? '' : 's'} sold this period with no quote marked sold; the amount used is the starred or newest quote:`, list: c.soldFromOther } : null,
    c.soldNoPrice.length ? { k: 'sn', text: `${c.soldNoPrice.length} building${c.soldNoPrice.length === 1 ? '' : 's'} sold this period with no priced quote on file (not in $ sold or Average deal):`, list: c.soldNoPrice } : null,
    c.multiSold.length ? { k: 'ms', text: `${c.multiSold.length} sold lead${c.multiSold.length === 1 ? ' has' : 's have'} more than one quote marked sold; the amount used is the newest Deposit Paid / Revised Order one (two buildings, or an old quote to mark Superseded?):`, list: c.multiSold } : null,
    c.depositPending.length ? { k: 'dp', text: `${c.depositPending.length} lead${c.depositPending.length === 1 ? ' is' : 's are'} at "Pending Deposit": shown as Ordered elsewhere in the CRM, counted here as open (not sold) until marked Ordered:`, list: c.depositPending } : null,
    c.unknownStatus.length ? { k: 'us', text: `${c.unknownStatus.length} lead${c.unknownStatus.length === 1 ? ' has' : 's have'} a stage this page does not know (not counted as open, sold or dead):`, list: c.unknownStatus, render: (x) => <span style={MUTED}> ({x.status})</span> } : null,
    c.dupes.length ? { k: 'du', text: `${c.dupes.length} possible duplicate lead${c.dupes.length === 1 ? '' : 's'} (same phone or email) among this period's leads:`, list: c.dupes.map((d) => ({ id: d.ids[1], name: `${d.names[0]} = ${d.names[1]}` })) } : null,
    c.unknownRep.length ? { k: 'ur', text: `${c.unknownRep.length} lead${c.unknownRep.length === 1 ? ' is' : 's are'} assigned to a login the CRM no longer knows (shown as "Unknown rep"):`, list: c.unknownRep } : null,
    c.testLeads.length ? { k: 'tl', text: `${c.testLeads.length} test lead${c.testLeads.length === 1 ? '' : 's'} left out of every number:`, list: c.testLeads } : null,
  ].filter(Boolean)
  return (
    <Panel title="Numbers to check" right={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'nothing to check'}>
      {items.length === 0 ? <div className="ana-empty">Nothing here: every sold lead has an order date and a sold quote.</div> : (
        <ul className="perf-checks">
          {items.map((it) => <li key={it.k}>{it.text} <LeadList items={it.list} render={it.render} /></li>)}
        </ul>
      )}
    </Panel>
  )
}
