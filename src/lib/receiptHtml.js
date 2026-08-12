// receiptHtml.js — branded payment-receipt document for StormSafe Steel.
// Produces a self-contained HTML document (inline CSS, Google Fonts) that
// renders to PDF through the same Electron print-to-PDF path as quotes and
// contracts (lib/builderSave renderQuotePdf). Print-friendly light theme:
// white page, Orbitron headers, Inter body, teal accents — clients print
// these, so the page background must stay white (no ink-heavy dark fills).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const money = (n) => {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return String(iso) }
}

/**
 * data = {
 *   client: { name, email, phone, city, state },
 *   quote:  { quote_number, building_size, building_summary, total_amount },
 *   receipt: { number, date (yyyy-mm-dd), amount, method, reference,
 *              appliedTo, remaining, note }
 * }
 */
export function buildReceiptHtml({ client = {}, quote = {}, receipt = {} }) {
  const paidInFull = receipt.appliedTo === 'Paid in Full' || Number(receipt.remaining) === 0
  const remainColor = paidInFull ? '#059669' : '#0f172a'
  const building = [quote.building_size, quote.building_summary].filter(Boolean).join(' — ')
  // CCI orders: the building is sold by Carolina Carports, Inc. — the document
  // is their BILL OF SALE (same liability treatment as the CCI contract), with
  // StormSafe as the authorized dealer.
  const isCCI = String(quote.manufacturer || '').toLowerCase() === 'cci'
  const docTitle = isCCI ? 'Bill of Sale' : 'Payment Receipt'
  const rows = [
    ['Payment Date', fmtDate(receipt.date)],
    ['Payment Method', receipt.method || '—'],
    receipt.reference ? ['Reference #', receipt.reference] : null,
    ['Applied To', receipt.appliedTo || 'Deposit'],
    quote.quote_number ? ['Quote / Order #', quote.quote_number] : null,
    isCCI ? ['Seller', 'Carolina Carports, Inc.'] : null,
    isCCI ? ['Dealer', 'StormSafe Steel'] : null,
  ].filter(Boolean)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(receipt.number || docTitle)} — ${isCCI ? 'Carolina Carports, Inc.' : 'StormSafe Steel'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #ffffff; }
  body {
    font-family: 'Inter', system-ui, sans-serif; color: #0f172a;
    width: 8.5in; min-height: 11in; margin: 0 auto; padding: 0.55in 0.6in;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-size: 10.5pt; line-height: 1.55;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 2px solid #22d3c8; }
  .wordmark { font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 21pt; letter-spacing: .04em; text-transform: uppercase; color: #0f172a; }
  .wordmark .safe { color: #0d9488; }
  .tagline { color: #64748b; font-size: 8.5pt; margin-top: 4px; letter-spacing: .02em; }
  .doc-type { text-align: right; }
  .doc-type .t { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 15pt; letter-spacing: .08em; text-transform: uppercase; color: #0d9488; }
  .doc-type .st { font-family: 'Orbitron', sans-serif; font-weight: 600; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; color: #64748b; margin-top: 3px; }
  .doc-type .n { font-size: 9.5pt; color: #64748b; margin-top: 6px; }
  .doc-type .n b { color: #0f172a; font-weight: 600; }
  .seller { margin-top: 8px; font-size: 9pt; color: #475569; }
  .seller b { color: #0f172a; }

  .paid-band { margin: 26px 0 22px; background: rgba(34,211,200,.08); border: 1px solid #22d3c8; border-radius: 10px; padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; }
  .paid-band .lbl { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 10pt; letter-spacing: .1em; text-transform: uppercase; color: #0f766e; }
  .paid-band .sub { color: #64748b; font-size: 9pt; margin-top: 5px; }
  .paid-band .amt { font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 26pt; color: #0d9488; letter-spacing: .02em; }

  .cols { display: flex; gap: 20px; margin-bottom: 22px; }
  .panel { flex: 1; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px 18px; }
  .panel h3 { font-family: 'Orbitron', sans-serif; font-size: 8.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f766e; margin-bottom: 10px; }
  .panel .big { font-size: 12pt; font-weight: 600; color: #0f172a; }
  .panel .meta { color: #64748b; font-size: 9.5pt; margin-top: 2px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }
  .kv:last-child { border-bottom: 0; }
  .kv .k { color: #64748b; }
  .kv .v { color: #0f172a; font-weight: 600; text-align: right; }

  .bldg { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; }
  .bldg h3 { font-family: 'Orbitron', sans-serif; font-size: 8.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f766e; margin-bottom: 6px; }
  .bldg .d { font-size: 10.5pt; color: #0f172a; }

  table.acct { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
  table.acct th { font-family: 'Orbitron', sans-serif; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #64748b; text-align: left; padding: 8px 14px; border-bottom: 1px solid #cbd5e1; }
  table.acct th:last-child { text-align: right; }
  table.acct td { padding: 9px 14px; border-bottom: 1px solid #e2e8f0; font-size: 10.5pt; }
  table.acct td:last-child { text-align: right; font-weight: 600; }
  table.acct tr.pay td { color: #0d9488; }
  table.acct tr.rem td { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 11.5pt; border-bottom: 0; padding-top: 12px; }
  table.acct tr.rem td:last-child { color: ${remainColor}; }

  .note { background: #f0fdfa; border-left: 3px solid #0d9488; border-radius: 0 8px 8px 0; padding: 10px 14px; font-size: 9.5pt; color: #334155; margin-bottom: 22px; }

  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; }
  .foot .co { font-size: 8.5pt; color: #64748b; line-height: 1.7; }
  .foot .co b { color: #0f172a; }
  .foot .legal { font-size: 7.5pt; color: #64748b; text-align: right; max-width: 3.4in; }
  .thanks { font-size: 10pt; color: #0f172a; margin: 4px 0 24px; }
  .thanks b { color: #0d9488; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="wordmark">Storm<span class="safe">Safe</span> Steel</div>
      <div class="tagline">Hurricane-Rated Steel Buildings · West Palm Beach, FL</div>
      ${isCCI ? '<div class="seller">Building manufactured &amp; sold by <b>Carolina Carports, Inc.</b> — StormSafe Steel, Authorized Dealer</div>' : ''}
    </div>
    <div class="doc-type">
      <div class="t">${docTitle}</div>
      ${isCCI ? '<div class="st">Payment Receipt</div>' : ''}
      <div class="n">${isCCI ? 'Document' : 'Receipt'} <b>${esc(receipt.number || '—')}</b></div>
      <div class="n">Issued <b>${esc(fmtDate(receipt.date))}</b></div>
    </div>
  </div>

  <div class="paid-band">
    <div>
      <div class="lbl">${paidInFull ? 'Payment Received — Paid in Full' : 'Payment Received'}</div>
      <div class="sub">Thank you, ${esc(client.name || 'valued customer')} — this payment has been applied to your order.</div>
    </div>
    <div class="amt">${money(receipt.amount)}</div>
  </div>

  <div class="cols">
    <div class="panel">
      <h3>Received From</h3>
      <div class="big">${esc(client.name || '—')}</div>
      ${client.email ? `<div class="meta">${esc(client.email)}</div>` : ''}
      ${client.phone ? `<div class="meta">${esc(client.phone)}</div>` : ''}
      ${(client.city || client.state) ? `<div class="meta">${esc([client.city, client.state].filter(Boolean).join(', '))}</div>` : ''}
    </div>
    <div class="panel">
      <h3>Payment Details</h3>
      ${rows.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    </div>
  </div>

  ${building ? `<div class="bldg"><h3>Building</h3><div class="d">${esc(building)}</div>${isCCI ? '<div class="d" style="color:#64748b;font-size:9pt;margin-top:3px">Manufacturer: Carolina Carports, Inc. (CCI)</div>' : ''}</div>` : ''}

  <table class="acct">
    <tr><th>Account Summary</th><th>Amount</th></tr>
    ${isFinite(Number(quote.total_amount)) ? `<tr><td>Order Total</td><td>${money(quote.total_amount)}</td></tr>` : ''}
    <tr class="pay"><td>This Payment — ${esc(receipt.appliedTo || 'Deposit')}</td><td>&minus; ${money(receipt.amount)}</td></tr>
    <tr class="rem"><td>Remaining Balance</td><td>${paidInFull ? 'PAID IN FULL' : money(receipt.remaining)}</td></tr>
  </table>

  ${receipt.note ? `<div class="note">${esc(receipt.note)}</div>` : ''}

  <div class="thanks">Thank you for choosing <b>StormSafe Steel</b>. We look forward to building with you.</div>

  <div class="foot">
    <div class="co">
      <b>StormSafe Steel</b><br>
      8480 Okeechobee Blvd, Suite 5 · West Palm Beach, FL 33411<br>
      (561) 771-5555 · ops@stormsafesteel.com · stormsafesteel.com
    </div>
    <div class="legal">
      ${isCCI
        ? `This bill of sale confirms receipt of the payment shown above toward
      the building described, manufactured and sold by Carolina Carports, Inc.
      (CCI). StormSafe Steel is an authorized Carolina Carports dealer.
      Remaining balances are due per your signed Carolina Carports purchase
      agreement and its terms &amp; conditions.`
        : `This document confirms receipt of the payment shown above and is not an
      invoice. Remaining balances are due per your signed purchase agreement.
      Prices subject to change based on steel market conditions and local
      engineering requirements.`}
    </div>
  </div>
</body>
</html>`
}

/** Document number: BOS (CCI bill of sale) / RCPT + quote number, date-stamped. */
export function makeReceiptNumber(quote) {
  const prefix = String(quote?.manufacturer || '').toLowerCase() === 'cci' ? 'BOS' : 'RCPT'
  const base = quote?.quote_number ? String(quote.quote_number).replace(/^SS-?/, '') : null
  const stamp = new Date()
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
  return base ? `${prefix}-${base}-${ymd}` : `${prefix}-${ymd}-${String(Date.now()).slice(-4)}`
}
