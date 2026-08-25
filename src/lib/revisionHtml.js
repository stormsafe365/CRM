// revisionHtml.js — Revision Order document for StormSafe Steel, generated
// FILLED-IN from the RevisionModal (no handwriting): the rep types each change
// and price adjustment on screen and this renders the finished document.
// Amends a signed order (colors, doors, size…). Rendered to PDF through the
// same Electron print path as receipts / color sheets (builderSave
// renderQuotePdf) and saved to Document Hub › Revisions.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const money = (n) => {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (v < 0 ? '−$' : '$') + abs
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return String(iso) }
}

const MFR_NAMES = { cci: 'Carolina Carports, Inc.', ca: 'Carports Anywhere' }

/** Summarize the saved build's components (payload_json) for the as-quoted table. */
export function componentsFromPayload(payload) {
  if (!payload) return []
  const out = []
  for (const d of payload.doors || []) {
    if (!d.rsz && !d.rloc) continue
    out.push({ name: `Roll-Up Door${d.rsz ? ' ' + String(d.rsz).replace('x', '×') : ''}`, qty: d.rqt || '1', wall: d.rloc || '—' })
  }
  for (const w of payload.wtds || []) {
    out.push({ name: 'Walk-Through Door', qty: w.wqt || '1', wall: w.wloc || '—' })
  }
  for (const n of payload.windows || []) {
    out.push({ name: 'Window', qty: n.nqt || '1', wall: n.nloc || '—' })
  }
  return out
}

/**
 * data = {
 *   client:   { name, email, phone, city, state },
 *   quote:    { quote_number, quote_date, building_size, building_summary,
 *               manufacturer, payload_json },
 *   revision: { number, revNo, date, rows: [{ desc, kind, amount }],
 *               original, additions, credits, revised, note }
 * }
 */
export function buildRevisionHtml({ client = {}, quote = {}, revision = {} }) {
  const building = [quote.building_size, quote.building_summary].filter(Boolean).join(' — ')
  const mfrName = MFR_NAMES[String(quote.manufacturer || '').toLowerCase()] || null
  const comps = componentsFromPayload(quote.payload_json)
  const rows = (revision.rows || []).filter((r) => r.desc && String(r.desc).trim())

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(revision.number || 'Revision Order')} — StormSafe Steel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #ffffff; }
  body {
    font-family: 'Inter', system-ui, sans-serif; color: #0f172a;
    width: 8.5in; min-height: 11in; margin: 0 auto; padding: 0.42in 0.6in;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-size: 10pt; line-height: 1.5;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #22d3c8; }
  .wordmark { font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 21pt; letter-spacing: .04em; text-transform: uppercase; color: #0f172a; }
  .wordmark .safe { color: #0d9488; }
  .tagline { color: #64748b; font-size: 8.5pt; margin-top: 4px; letter-spacing: .02em; }
  .doc-type { text-align: right; }
  .doc-type .t { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 15pt; letter-spacing: .08em; text-transform: uppercase; color: #0d9488; }
  .doc-type .n { font-size: 9.5pt; color: #64748b; margin-top: 5px; }
  .doc-type .n b { color: #0f172a; font-weight: 600; }

  .cols { display: flex; gap: 18px; margin: 16px 0 14px; }
  .panel { flex: 1; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 11px 16px; }
  .panel h3 { font-family: 'Orbitron', sans-serif; font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f766e; margin-bottom: 7px; }
  .panel .big { font-size: 11.5pt; font-weight: 600; color: #0f172a; }
  .panel .meta { color: #64748b; font-size: 9pt; margin-top: 2px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 3.5px 0; border-bottom: 1px solid #e2e8f0; font-size: 9pt; }
  .kv:last-child { border-bottom: 0; }
  .kv .k { color: #64748b; }
  .kv .v { color: #0f172a; font-weight: 600; text-align: right; }

  .sec-t { font-family: 'Orbitron', sans-serif; font-size: 9.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f172a; margin: 12px 0 7px; }
  table.tbl { width: 100%; border-collapse: collapse; }
  table.tbl th { font-family: 'Orbitron', sans-serif; font-size: 7.5pt; letter-spacing: .09em; text-transform: uppercase; color: #64748b; text-align: left; padding: 6px 10px; border-bottom: 1px solid #cbd5e1; }
  table.tbl td { padding: 6.5px 10px; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }
  table.tbl th.r, table.tbl td.r { text-align: right; }
  table.tbl td.r { font-weight: 600; font-variant-numeric: tabular-nums; }
  .kind { display: inline-block; font-size: 7.5pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border-radius: 99px; padding: 2px 9px; border: 1px solid #cbd5e1; color: #475569; }
  .kind.add { color: #0f766e; border-color: #22d3c8; background: rgba(34,211,200,.08); }
  .kind.remove { color: #b91c1c; border-color: #fca5a5; background: rgba(248,113,113,.08); }

  table.sum { width: 3.6in; margin-left: auto; border-collapse: collapse; margin-top: 10px; }
  table.sum td { padding: 5px 10px; font-size: 9.5pt; border-bottom: 1px solid #e2e8f0; }
  table.sum td:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  table.sum tr.rev td { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 11pt; border-bottom: 0; border-top: 2px solid #22d3c8; padding-top: 8px; color: #0f172a; }
  table.sum tr.rev td:last-child { color: #0d9488; }

  .note { background: #f0fdfa; border-left: 3px solid #0d9488; border-radius: 0 8px 8px 0; padding: 9px 13px; font-size: 9pt; color: #334155; margin-top: 12px; }

  .terms { margin-top: 14px; }
  .terms p { font-size: 8pt; color: #475569; margin-bottom: 4px; }

  .sig { display: flex; gap: 24px; margin-top: 24px; }
  .sig .box { flex: 1.5; }
  .sig .box.sm { flex: 1; }
  .sig .line { border-bottom: 1.5px solid #0f172a; height: 26px; }
  .sig .cap { font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #64748b; margin-top: 4px; }

  .foot { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 8.5pt; color: #64748b; line-height: 1.6; }
  .foot b { color: #0f172a; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="wordmark">Storm<span class="safe">Safe</span> Steel</div>
      <div class="tagline">Hurricane-Rated Steel Buildings · West Palm Beach, FL</div>
    </div>
    <div class="doc-type">
      <div class="t">Revision Order</div>
      <div class="n">Document <b>${esc(revision.number || '—')}</b></div>
      <div class="n">Revision <b>#${esc(revision.revNo || '1')}</b> · Issued <b>${esc(fmtDate(revision.date))}</b></div>
    </div>
  </div>

  <div class="cols">
    <div class="panel">
      <h3>Customer</h3>
      <div class="big">${esc(client.name || '—')}</div>
      ${client.phone ? `<div class="meta">${esc(client.phone)}</div>` : ''}
      ${client.email ? `<div class="meta">${esc(client.email)}</div>` : ''}
      ${(client.city || client.state) ? `<div class="meta">${esc([client.city, client.state].filter(Boolean).join(', '))}</div>` : ''}
    </div>
    <div class="panel">
      <h3>Original Order</h3>
      ${quote.quote_number ? `<div class="kv"><span class="k">Quote / Order #</span><span class="v">${esc(quote.quote_number)}</span></div>` : ''}
      ${quote.quote_date ? `<div class="kv"><span class="k">Order Date</span><span class="v">${esc(fmtDate(quote.quote_date))}</span></div>` : ''}
      ${mfrName ? `<div class="kv"><span class="k">Manufacturer</span><span class="v">${esc(mfrName)}</span></div>` : ''}
      ${building ? `<div class="kv"><span class="k">Building</span><span class="v">${esc(building)}</span></div>` : ''}
    </div>
  </div>

  ${comps.length ? `
  <div class="sec-t">Current Components (As-Quoted)</div>
  <table class="tbl">
    <tr><th>Component</th><th>Qty</th><th>Wall</th></tr>
    ${comps.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.qty)}</td><td>${esc(c.wall)}</td></tr>`).join('')}
  </table>` : ''}

  <div class="sec-t">Changes to This Order</div>
  <table class="tbl">
    <tr><th style="width:58%">Description of Change</th><th>Type</th><th class="r">Price Adjustment</th></tr>
    ${rows.map((r) => {
      const amt = Number(r.amount)
      const kindCls = r.kind === 'Add' ? 'add' : r.kind === 'Remove' ? 'remove' : ''
      return `<tr>
        <td>${esc(r.desc)}</td>
        <td><span class="kind ${kindCls}">${esc(r.kind || 'Modify')}</span></td>
        <td class="r">${isFinite(amt) && r.amount !== '' && amt !== 0 ? money(amt) : '$0.00'}</td>
      </tr>`
    }).join('')}
  </table>

  <table class="sum">
    <tr><td>Original Contract Price</td><td>${money(revision.original)}</td></tr>
    <tr><td>Total Additions (+)</td><td>${money(revision.additions)}</td></tr>
    <tr><td>Total Credits (−)</td><td>${Number(revision.credits) ? '−' + money(revision.credits).replace('−', '') : '$0.00'}</td></tr>
    <tr class="rev"><td>Revised Contract Price</td><td>${money(revision.revised)}</td></tr>
  </table>

  ${revision.note ? `<div class="note">${esc(revision.note)}</div>` : ''}

  <div class="terms">
    <div class="sec-t">Terms &amp; Conditions</div>
    <p>1. This Revision Order modifies the original agreement between the customer and StormSafe Steel. All terms of the original contract remain in effect except as specifically amended herein.</p>
    <p>2. Price adjustments are based on current steel market pricing at the time of this revision. Changes may affect lead time.</p>
    <p>3. Structural or dimensional changes may require updated engineering and permitting. Any additional engineering or permit fees are the responsibility of the customer.</p>
    <p>4. Once signed, this revision order is binding. Changes after production begins may incur additional cost and delay.</p>
  </div>

  <div class="sig">
    <div class="box">
      <div class="line"></div>
      <div class="cap">Customer Signature — ${esc(client.name || 'Customer')}</div>
    </div>
    <div class="box sm">
      <div class="line"></div>
      <div class="cap">Date</div>
    </div>
    <div class="box">
      <div class="line"></div>
      <div class="cap">StormSafe Steel — Authorized Representative</div>
    </div>
  </div>

  <div class="foot">
    <b>StormSafe Steel</b> · 8480 Okeechobee Blvd, Suite 5 · West Palm Beach, FL 33411 · (561) 771-5555 · ops@stormsafesteel.com · stormsafesteel.com
  </div>
</body>
</html>`
}

/** Document number: REV + quote number, date-stamped (mirrors the receipt/color sheet). */
export function makeRevisionOrderNumber(quote) {
  const base = quote?.quote_number ? String(quote.quote_number).replace(/^SS-?/, '') : null
  const stamp = new Date()
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
  return base ? `REV-${base}-${ymd}` : `REV-${ymd}-${String(Date.now()).slice(-4)}`
}
