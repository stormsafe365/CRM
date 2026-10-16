// perfReportHtml: the Performance page as a printable Letter document (light theme, like the
// receipt / revision documents), from the same computed numbers the page shows (perfStats.js).
// Pure: string in, string out; every name is escaped.

import { dayLabel } from './perfStats.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const c = Math.round(Number(n) * 100)
  const a = Math.abs(c) / 100
  const s = c % 100 === 0 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (c < 0 ? '−$' : '$') + s
}
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

/** r = computePerformance(...); opts.summary = the page's summary lines; opts.sourceLabel(value) */
export function buildPerformanceHtml(r, { summary = [], sourceLabel = (v) => v || 'Not recorded' } = {}) {
  const p = r.period
  const asOf = new Date(r.generatedAt || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const m = r.main
  const tile = (label, value, sub) => `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv">${esc(value)}</div><div class="ts">${esc(sub || '')}</div></div>`
  const trendRows = r.trend.map((b) => `<tr><td>${esc(b.label)}${b.partial ? ` · to ${esc(dayLabel(b.upTo))}` : ''}</td><td>${b.leadsIn}</td><td>${b.customersQuoted}</td><td>${money(b.quotedValue)}</td><td>${b.sold}</td><td>${money(b.soldValue)}</td><td>${b.deposits == null ? 'n/a' : money(b.deposits)}</td></tr>`).join('')
  const repRows = r.reps.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.openNow}</td><td>${x.newLeads}</td><td>${x.followUps}</td><td>${x.customersQuoted}</td><td>${x.quotedValue ? money(x.quotedValue) : '—'}</td><td>${x.sold}</td><td>${x.soldValue ? money(x.soldValue) : '—'}</td><td>${r.tracked ? (x.deposits ? money(x.deposits) : '—') : 'n/a'}</td><td class="${x.quiet ? 'warn' : ''}">${x.quiet}</td></tr>`).join('')
  const t = r.totals
  const srcRows = r.sources.length
    ? r.sources.map((s) => `<tr><td>${esc(sourceLabel(s.source))}</td><td>${s.leads}</td><td>${pct(s.leads / (m.leadsIn || 1))}</td><td>${s.quoted}</td><td>${s.ordered}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No new leads in this period.</td></tr>'
  const dealRows = r.deals.length
    ? r.deals.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.rep)}</td><td>${d.orderDay ? esc(dayLabel(d.orderDay, true)) : '—'}</td><td>${money(d.amount)}${d.amountFrom && d.amountFrom !== 'sold' ? ' *' : ''}</td><td>${r.tracked ? (d.deposit ? money(d.deposit) : '—') : 'n/a'}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No leads marked Ordered with an order date in this period.</td></tr>'
  const maxStage = Math.max(1, ...r.pipeline.map((s) => s.count))
  const stageRows = r.pipeline.map((s) => `<div class="bar"><span class="bl">${esc(s.label)}</span><span class="bt"><span style="width:${((s.count / maxStage) * 100).toFixed(1)}%"></span></span><b>${s.count}</b></div>`).join('')
  const c = r.checks
  const checks = [
    c.orderedNoDate.length ? `${c.orderedNoDate.length} marked Ordered with no order date (not counted as sold): ${c.orderedNoDate.map((x) => esc(x.name)).join(', ')}` : '',
    c.soldQuoteNotOrdered.length ? `${c.soldQuoteNotOrdered.length} with a sold quote but not marked Ordered: ${c.soldQuoteNotOrdered.map((x) => esc(x.name)).join(', ')}` : '',
    c.soldFromOther.length ? `${c.soldFromOther.length} sold with no quote marked sold (amount = starred / newest quote): ${c.soldFromOther.map((x) => esc(x.name)).join(', ')}` : '',
    c.dupes.length ? `${c.dupes.length} possible duplicate lead(s): ${c.dupes.map((d) => esc(`${d.names[0]} = ${d.names[1]}`)).join('; ')}` : '',
    c.testLeads.length ? `${c.testLeads.length} test lead(s) left out of every number` : '',
  ].filter(Boolean)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StormSafe Steel — Performance — ${esc(p.range)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { width: 8.5in; padding: 0.45in 0.5in; font-family: Inter, Arial, sans-serif; color: #0f172a; font-size: 10.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0d9488; padding-bottom: 8px; margin-bottom: 14px; }
.brand { font-family: Orbitron, Arial, sans-serif; font-weight: 800; letter-spacing: .06em; font-size: 13pt; text-transform: uppercase; }
.brand span { color: #0d9488; }
.brand small { display: block; font-family: Inter, Arial, sans-serif; font-weight: 500; letter-spacing: .14em; font-size: 7.5pt; color: #64748b; margin-top: 3px; }
.title { text-align: right; }
.title h1 { margin: 0; font-family: Orbitron, Arial, sans-serif; font-weight: 700; font-size: 17pt; letter-spacing: .04em; text-transform: uppercase; }
.title div { color: #475569; font-size: 9.5pt; margin-top: 3px; }
h2 { font-family: Orbitron, Arial, sans-serif; font-size: 10pt; letter-spacing: .1em; text-transform: uppercase; margin: 16px 0 6px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
.summary { background: #f0fdfa; border-left: 4px solid #0d9488; padding: 8px 12px 8px 26px; margin: 0; }
.summary li { margin: 3px 0; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.tile { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; break-inside: avoid; }
.tl { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: #0d9488; font-weight: 700; }
.tv { font-size: 15pt; font-weight: 700; margin-top: 2px; }
.ts { font-size: 7.5pt; color: #64748b; margin-top: 1px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; break-inside: avoid; }
th { text-align: right; font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; color: #475569; border-bottom: 1.5px solid #0f172a; padding: 4px 5px; }
td { text-align: right; padding: 4px 5px; border-bottom: 1px solid #e2e8f0; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; }
tr.total td { font-weight: 700; background: #f1f5f9; }
td.warn { color: #b91c1c; font-weight: 700; }
td.empty { text-align: left; color: #64748b; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; break-inside: avoid; }
.bar { display: grid; grid-template-columns: 1.6in 1fr 0.4in; align-items: center; gap: 8px; font-size: 8.5pt; margin: 3px 0; }
.bl { text-transform: uppercase; letter-spacing: .06em; color: #334155; }
.bt { height: 9px; background: #f1f5f9; border-radius: 5px; overflow: hidden; }
.bt span { display: block; height: 100%; background: #1e293b; }
.bar b { text-align: right; }
.mini { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 8px; }
.mini div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 7.5pt; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
.mini b { display: block; font-size: 13pt; color: #0f172a; letter-spacing: 0; }
.checks { margin: 0; padding-left: 18px; font-size: 9pt; }
.notes { font-size: 8pt; color: #475569; margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
section { break-inside: avoid; }
</style>
</head>
<body>
<div class="head">
  <div class="brand">Storm<span>Safe</span> Steel<small>Performance report · owner + Joshua only</small></div>
  <div class="title"><h1>${esc(p.label)}</h1><div>${esc(p.range)}${p.toDate ? ' · to date' : ''} · as of ${esc(asOf)}</div></div>
</div>

<section>
<h2>Summary</h2>
<ul class="summary">${summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</section>

<section>
<h2>At a glance</h2>
<div class="tiles">
  ${tile('Leads in', m.leadsIn, 'by the day they came in')}
  ${tile('Customers quoted', m.customersQuoted, `${m.quotesMade} quotes saved`)}
  ${tile('Quoted value', money(m.quotedValue), 'latest quote per customer, with tax')}
  ${tile('Buildings sold', m.sold, 'marked Ordered (order date)')}
  ${tile('$ sold', money(m.soldValue), 'quote totals, with tax')}
  ${tile('Deposits received', r.tracked ? money(m.deposits) : 'Not tracked yet', r.tracked ? `${m.depositCount} deposits` : '')}
  ${tile('Close rate', pct(r.closeRate.pct), `${r.closeRate.ordered} of ${r.closeRate.of} new leads Ordered now`)}
  ${tile('Average deal', money(m.avgDeal == null ? null : Math.round(m.avgDeal)), `${m.lost} marked Dead this period`)}
</div>
</section>

<section>
<h2>${r.period.grain === 'week' ? 'Six-week trend' : 'By month'}</h2>
<table><thead><tr><th>${r.period.grain === 'week' ? 'Week' : 'Month'}</th><th>Leads in</th><th>Customers quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th></tr></thead><tbody>${trendRows}</tbody></table>
</section>

<section>
<h2>By sales rep</h2>
<table><thead><tr><th>Rep</th><th>Open leads</th><th>New leads</th><th>Follow-ups</th><th>Quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th><th>No activity 14+ days</th></tr></thead>
<tbody>${repRows}<tr class="total"><td>Total</td><td>${t.openNow}</td><td>${t.newLeads}</td><td>${t.followUps}</td><td>${t.customersQuoted}</td><td>${money(t.quotedValue)}</td><td>${t.sold}</td><td>${money(t.soldValue)}</td><td>${r.tracked ? money(t.deposits) : 'n/a'}</td><td>${t.quiet}</td></tr></tbody></table>
</section>

<div class="two">
<section>
<h2>Where new leads came from</h2>
<table><thead><tr><th>Source</th><th>Leads</th><th>Share</th><th>Quoted</th><th>Ordered</th></tr></thead><tbody>${srcRows}</tbody></table>
</section>
<section>
<h2>How new leads were handled</h2>
<div class="mini" style="grid-template-columns: repeat(3, 1fr)">
  <div><b>${pct(r.handling.followedPct)}</b>followed up (${r.handling.followed} of ${r.handling.leads})</div>
  <div><b>${r.handling.medianHours == null ? '—' : r.handling.medianHours < 48 ? `${r.handling.medianHours.toFixed(1)} hrs` : `${(r.handling.medianHours / 24).toFixed(1)} days`}</b>median to first follow-up</div>
  <div><b>${pct(r.handling.within24Pct)}</b>within 24 hours</div>
</div>
</section>
</div>

<section>
<h2>Buildings sold</h2>
<table><thead><tr><th>Lead</th><th>Rep</th><th>Order date</th><th>Amount</th><th>Deposit received</th></tr></thead><tbody>${dealRows}</tbody></table>
</section>

<section>
<h2>Open pipeline · as of ${esc(asOf)}</h2>
${stageRows}
<div class="mini">
  <div><b>${r.ages.d30}</b>came in, last 30 days</div><div><b>${r.ages.d90}</b>31 – 90 days ago</div><div><b>${r.ages.d180}</b>91 – 180 days ago</div><div><b>${r.ages.older}</b>over 180 days ago</div>
</div>
</section>

${checks.length ? `<section><h2>Numbers to check</h2><ul class="checks">${checks.map((x) => `<li>${x}</li>`).join('')}</ul></section>` : ''}

<div class="notes">New York calendar days; weeks Monday to Sunday. Sold = marked Ordered, counted on its order date; amounts are quote totals with sales tax. Quoted = a quote saved with a price (latest per customer). Deposits = "Deposit received" entries on the order screen. Follow-ups = calls, emails, meetings and notes a rep logged. Left out: Trash, sample leads, leads named "test". Open pipeline is a live snapshot.</div>
</body>
</html>`
}
