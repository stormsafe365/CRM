// perfReportHtml: the Performance page as a printable Letter document (light theme, like the
// receipt / revision documents), from the same computed numbers the page shows (perfStats.js).
// Pure: string in, string out; every name is escaped.
//
// Every style is scoped under .prdoc with pr- class names: in the web CRM the PDF is drawn by
// html2pdf INSIDE the CRM page (its <style> lands next to the CRM's own), so a plain ".tile" or
// "body" rule would collide with the CRM's (review 10/16: dark tiles, invisible numbers).

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
const names = (list) => list.map((x) => esc(x.name)).join(', ')

/** The "Numbers to check" lines (same items as the page). Each is already escaped. */
export function reportChecks(c) {
  return [
    c.orderedNoDate.length ? `${c.orderedNoDate.length} marked Ordered with no order date (not counted as sold): ${names(c.orderedNoDate)}` : '',
    c.soldQuoteNotOrdered.length ? `${c.soldQuoteNotOrdered.length} with a quote marked Deposit Paid / Revised Order but not marked Ordered: ${names(c.soldQuoteNotOrdered)}` : '',
    c.soldFromOther.length ? `${c.soldFromOther.length} sold with no quote marked sold (amount = the starred / newest quote): ${names(c.soldFromOther)}` : '',
    c.soldNoPrice.length ? `${c.soldNoPrice.length} sold with no priced quote on file (not in $ sold or Average deal): ${names(c.soldNoPrice)}` : '',
    c.multiSold.length ? `${c.multiSold.length} sold lead(s) with more than one quote marked sold (amount = the newest Deposit Paid / Revised Order): ${names(c.multiSold)}` : '',
    c.depositPending.length ? `${c.depositPending.length} at "Pending Deposit" (shown as Ordered elsewhere in the CRM; open here, not sold): ${names(c.depositPending)}` : '',
    c.unknownStatus.length ? `${c.unknownStatus.length} with a stage this report does not know (not open, sold or dead): ${c.unknownStatus.map((x) => `${esc(x.name)} (${esc(x.status)})`).join(', ')}` : '',
    c.unknownRep.length ? `${c.unknownRep.length} assigned to a login the CRM no longer knows ("Unknown rep"): ${names(c.unknownRep)}` : '',
    c.dupes.length ? `${c.dupes.length} possible duplicate lead(s) (same phone or email): ${c.dupes.map((d) => esc(`${d.names[0]} = ${d.names[1]}`)).join('; ')}` : '',
    c.testLeads.length ? `${c.testLeads.length} test lead(s) left out of every number: ${names(c.testLeads)}` : '',
  ].filter(Boolean)
}

/** r = computePerformance(...); opts.summary = the page's summary lines; opts.sourceLabel(value) */
export function buildPerformanceHtml(r, { summary = [], sourceLabel = (v) => v || 'Not recorded' } = {}) {
  const p = r.period
  const asOf = new Date(r.generatedAt || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const m = r.main
  const depKnown = r.tracked && m.deposits != null
  const tile = (label, value, sub) => `<div class="pr-tile"><div class="pr-tl">${esc(label)}</div><div class="pr-tv">${esc(value)}</div><div class="pr-ts">${esc(sub || '')}</div></div>`
  const trendRows = r.trend.map((b) => `<tr class="${b.inPeriod ? 'pr-cur' : ''}"><td>${esc(b.label)}${b.partial ? ` · to ${esc(dayLabel(b.upTo))}` : ''}${b.startsBefore ? ` · the period starts ${esc(dayLabel(p.from))}` : ''}</td><td>${b.leadsIn}</td><td>${b.customersQuoted}</td><td>${money(b.quotedValue)}</td><td>${b.sold}</td><td>${money(b.soldValue)}</td><td>${b.deposits == null ? 'n/a' : money(b.deposits)}</td></tr>`).join('')
  const repRows = r.reps.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.openNow}</td><td>${x.newLeads}</td><td>${x.followUps}</td><td>${x.customersQuoted}</td><td>${x.quotedValue ? money(x.quotedValue) : '—'}</td><td>${x.sold}</td><td>${x.soldValue ? money(x.soldValue) : '—'}</td><td>${depKnown ? (x.deposits ? money(x.deposits) : '—') : 'n/a'}</td><td class="${x.quiet ? 'pr-warn' : ''}">${x.quiet}</td></tr>`).join('')
  const t = r.totals
  const srcRows = r.sources.length
    ? r.sources.map((s) => `<tr><td>${esc(sourceLabel(s.source))}</td><td>${s.leads}</td><td>${pct(s.leads / (m.leadsIn || 1))}</td><td>${s.quoted}</td><td>${s.ordered}</td></tr>`).join('')
    : '<tr><td colspan="5" class="pr-empty">No new leads in this period.</td></tr>'
  const star = (d) => (d.amountFrom === 'starred' || d.amountFrom === 'newest' ? ' *' : '') + (d.multiSold ? ' †' : '')
  const dealRows = r.deals.length
    ? r.deals.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.rep)}</td><td>${d.orderDay ? esc(dayLabel(d.orderDay, true)) : '—'}</td><td>${money(d.amount)}${star(d)}</td><td>${r.tracked ? (d.depositAll ? money(d.depositAll) : '—') : 'n/a'}</td></tr>`).join('')
    : '<tr><td colspan="5" class="pr-empty">No leads marked Ordered with an order date in this period.</td></tr>'
  const dealNotes = [
    r.deals.some((d) => d.amountFrom === 'starred' || d.amountFrom === 'newest') ? '* No quote marked sold on that lead: the amount is its starred (or newest) quote.' : '',
    r.deals.some((d) => d.multiSold) ? '† More than one quote on that lead is marked sold: the amount is the newest Deposit Paid / Revised Order one.' : '',
  ].filter(Boolean)
  const depRows = r.depositRows.length
    ? r.depositRows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.day ? esc(dayLabel(x.day, true)) : '—'}</td><td>${esc(x.method || '—')}</td><td>${money(x.amount)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="pr-empty">No deposits received in this period.</td></tr>'
  const maxStage = Math.max(1, ...r.pipeline.map((s) => s.count))
  const stageRows = r.pipeline.map((s) => `<div class="pr-bar"><span class="pr-bl">${esc(s.label)}</span><span class="pr-bt"><span style="width:${((s.count / maxStage) * 100).toFixed(1)}%"></span></span><b>${s.count}</b></div>`).join('')
  const checks = reportChecks(r.checks)
  const depTile = !r.tracked ? ['Not tracked yet', ''] : m.deposits == null ? ['n/a', `counted from ${dayLabel(r.depositsSince, true)}`] : [money(m.deposits), `${m.depositCount} deposits · from ${dayLabel(r.depositsSince)}`]

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StormSafe Steel — Performance — ${esc(p.range)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: letter; margin: 0.45in 0.5in; }
.prdoc, .prdoc * { box-sizing: border-box; }
.prdoc { background: #fff; color: #0f172a; font-family: Inter, Arial, sans-serif; font-size: 10.5pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-align: left; }
.prdoc .pr-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0d9488; padding: 0 0 8px; margin: 0 0 14px; background: #fff; }
.prdoc .pr-brand { display: block; font-family: Orbitron, Arial, sans-serif; font-weight: 800; letter-spacing: .06em; font-size: 13pt; text-transform: uppercase; color: #0f172a; background: none; border: 0; padding: 0; box-shadow: none; }
.prdoc .pr-brand span { color: #0d9488; }
.prdoc .pr-brand small { display: block; font-family: Inter, Arial, sans-serif; font-weight: 500; letter-spacing: .14em; font-size: 7.5pt; color: #64748b; margin-top: 3px; }
.prdoc .pr-title { text-align: right; }
.prdoc .pr-title h1 { margin: 0; font-family: Orbitron, Arial, sans-serif; font-weight: 700; font-size: 17pt; letter-spacing: .04em; text-transform: uppercase; color: #0f172a; }
.prdoc .pr-title div { color: #475569; font-size: 9.5pt; margin-top: 3px; }
.prdoc h2 { font-family: Orbitron, Arial, sans-serif; font-size: 10pt; letter-spacing: .1em; text-transform: uppercase; margin: 16px 0 6px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding: 0 0 4px; background: none; }
.prdoc .pr-summary { background: #f0fdfa; border-left: 4px solid #0d9488; padding: 8px 12px 8px 26px; margin: 0; color: #0f172a; }
.prdoc .pr-summary li { margin: 3px 0; }
.prdoc .pr-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.prdoc .pr-tile { background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; break-inside: avoid; box-shadow: none; }
.prdoc .pr-tl { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: #0d9488; font-weight: 700; }
.prdoc .pr-tv { font-size: 15pt; font-weight: 700; margin-top: 2px; color: #0f172a; }
.prdoc .pr-ts { font-size: 7.5pt; color: #64748b; margin-top: 1px; }
.prdoc table { width: 100%; border-collapse: collapse; font-size: 9pt; break-inside: avoid; background: #fff; }
.prdoc th { text-align: right; font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; color: #475569; background: #fff; border-bottom: 1.5px solid #0f172a; padding: 4px 5px; font-weight: 600; }
.prdoc td { text-align: right; padding: 4px 5px; border-bottom: 1px solid #e2e8f0; font-variant-numeric: tabular-nums; color: #0f172a; background: #fff; }
.prdoc th:first-child, .prdoc td:first-child { text-align: left; }
.prdoc tr.pr-total td { font-weight: 700; background: #f1f5f9; }
.prdoc tr.pr-cur td { background: #f0fdfa; }
.prdoc td.pr-warn { color: #b91c1c; font-weight: 700; }
.prdoc td.pr-empty { text-align: left; color: #64748b; }
.prdoc .pr-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; break-inside: avoid; }
.prdoc .pr-bar { display: grid; grid-template-columns: 1.6in 1fr 0.4in; align-items: center; gap: 8px; font-size: 8.5pt; margin: 3px 0; }
.prdoc .pr-bl { text-transform: uppercase; letter-spacing: .06em; color: #334155; }
.prdoc .pr-bt { height: 9px; background: #f1f5f9; border-radius: 5px; overflow: hidden; }
.prdoc .pr-bt span { display: block; height: 100%; background: #1e293b; }
.prdoc .pr-bar b { text-align: right; }
.prdoc .pr-mini { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 8px; }
.prdoc .pr-mini div { background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 7.5pt; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
.prdoc .pr-mini b { display: block; font-size: 13pt; color: #0f172a; letter-spacing: 0; }
.prdoc .pr-small { font-size: 8pt; color: #475569; margin: 4px 0 0; }
.prdoc .pr-checks { margin: 0; padding-left: 18px; font-size: 9pt; color: #0f172a; }
.prdoc .pr-notes { font-size: 8pt; color: #475569; margin-top: 14px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
.prdoc .pr-sec { break-inside: avoid; }
</style>
</head>
<body style="margin:0;background:#fff">
<div class="prdoc">
<div class="pr-head">
  <div class="pr-brand">Storm<span>Safe</span> Steel<small>Performance report · owner + Joshua only</small></div>
  <div class="pr-title"><h1>${esc(p.label)}</h1><div>${esc(p.range)}${p.toDate ? ' · to date' : ''} · as of ${esc(asOf)}</div></div>
</div>

<div class="pr-sec">
<h2>Summary</h2>
<ul class="pr-summary">${summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</div>

<div class="pr-sec">
<h2>At a glance</h2>
<div class="pr-tiles">
  ${tile('Leads in', m.leadsIn, 'by the day they came in')}
  ${tile('Customers quoted', m.customersQuoted, `${m.quotesMade} quotes saved`)}
  ${tile('Quoted value', money(m.quotedValue), 'latest quote per customer, with tax')}
  ${tile('Buildings sold', m.sold, 'marked Ordered (order date)')}
  ${tile('$ sold', money(m.soldValue), m.soldNoAmount ? `${m.soldNoAmount} sold with no priced quote` : 'quote totals, with tax')}
  ${tile('Deposits received', depTile[0], depTile[1])}
  ${tile('Close rate', pct(r.closeRate.pct), `${r.closeRate.ordered} of ${r.closeRate.of} new leads Ordered now`)}
  ${tile('Average deal', money(m.avgDeal == null ? null : Math.round(m.avgDeal)), `${m.lost} marked Dead this period`)}
</div>
</div>

<div class="pr-sec">
<h2>${r.period.grain === 'week' ? 'Six-week trend' : 'By month'}</h2>
<table><thead><tr><th>${r.period.grain === 'week' ? 'Week' : 'Month'}</th><th>Leads in</th><th>Customers quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th></tr></thead><tbody>${trendRows}</tbody></table>
<p class="pr-small">Whole weeks / months; the shaded rows are inside the period.</p>
</div>

<div class="pr-sec">
<h2>By sales rep</h2>
<table><thead><tr><th>Rep</th><th>Open leads</th><th>New leads</th><th>Follow-ups</th><th>Quoted</th><th>Quoted value</th><th>Sold</th><th>$ sold</th><th>Deposits</th><th>No activity 14+ days</th></tr></thead>
<tbody>${repRows}<tr class="pr-total"><td>Total</td><td>${t.openNow}</td><td>${t.newLeads}</td><td>${t.followUps}</td><td>${t.customersQuoted}</td><td>${money(t.quotedValue)}</td><td>${t.sold}</td><td>${money(t.soldValue)}</td><td>${depKnown ? money(t.deposits) : 'n/a'}</td><td>${t.quiet}</td></tr></tbody></table>
</div>

<div class="pr-two">
<div class="pr-sec">
<h2>Where new leads came from</h2>
<table><thead><tr><th>Source</th><th>Leads</th><th>Share</th><th>Quoted</th><th>Ordered</th></tr></thead><tbody>${srcRows}</tbody></table>
</div>
<div class="pr-sec">
<h2>How new leads were handled</h2>
<div class="pr-mini" style="grid-template-columns: repeat(3, 1fr)">
  <div><b>${pct(r.handling.followedPct)}</b>followed up (${r.handling.followed} of ${r.handling.leads})</div>
  <div><b>${r.handling.medianHours == null ? '—' : r.handling.medianHours < 1 ? `${Math.max(1, Math.round(r.handling.medianHours * 60))} min` : r.handling.medianHours < 48 ? `${r.handling.medianHours.toFixed(1)} hrs` : `${(r.handling.medianHours / 24).toFixed(1)} days`}</b>median to first follow-up</div>
  <div><b>${pct(r.handling.within24Pct)}</b>of those within 24 hours</div>
</div>
${r.handling.untimed ? `<p class="pr-small">${r.handling.untimed} entered after their first-contact day: followed up, not timed.</p>` : ''}
</div>
</div>

<div class="pr-sec">
<h2>Buildings sold</h2>
<table><thead><tr><th>Lead</th><th>Rep</th><th>Order date</th><th>Amount</th><th>Deposits on file (all dates)</th></tr></thead><tbody>${dealRows}</tbody></table>
${dealNotes.map((n) => `<p class="pr-small">${esc(n)}</p>`).join('')}
</div>

${r.tracked ? `<div class="pr-sec">
<h2>Deposits received this period${depKnown ? ` · ${money(m.deposits)}` : ` · counted from ${esc(dayLabel(r.depositsSince, true))}`}</h2>
<table><thead><tr><th>Lead</th><th>Received</th><th>Paid by</th><th>Amount</th></tr></thead><tbody>${depRows}</tbody></table>
</div>` : ''}

<div class="pr-sec">
<h2>Open pipeline · as of ${esc(asOf)}</h2>
${stageRows}
<div class="pr-mini">
  <div><b>${r.ages.d30}</b>came in, last 30 days</div><div><b>${r.ages.d90}</b>31 – 90 days ago</div><div><b>${r.ages.d180}</b>91 – 180 days ago</div><div><b>${r.ages.older}</b>over 180 days ago</div>
</div>
</div>

${checks.length ? `<div class="pr-sec"><h2>Numbers to check</h2><ul class="pr-checks">${checks.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}

<div class="pr-notes">New York calendar days; weeks Monday to Sunday. Sold = marked Ordered, counted on its order date; amounts are quote totals with sales tax ("Pending Deposit" counts as open). Quoted = a quote saved with a price (latest per customer). Deposits = "Deposit received" entries on the order screen, by the day received${r.tracked && r.depositsSince ? `, counted from ${esc(dayLabel(r.depositsSince, true))}` : ''}. Follow-ups = calls, emails, meetings and notes a rep logged. Left out: Trash, sample leads, leads named "test". The open pipeline is a live snapshot.</div>
</div>
</body>
</html>`
}
