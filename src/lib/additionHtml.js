// additionHtml.js - the ADDITION ORDER document (lib/additionOrder), in the contract's own look: the quote program's
// contract CSS, header, footer and terms (lib/contractParts.generated.js, read out of the program). Page 1 = the
// order (buyer, jobsite, what is added to which building, itemized prices, payment, signature); page 2 = the terms the
// manufacturer's contract carries - CCI's own "Terms, Conditions, and Warranties" for a CCI job, StormSafe's for CA -
// with the acknowledgment and both signatures. First made by hand for Robert Andrews (SS-2026-79957-A, 11/19/26).
// Rendered to PDF through the shared print path (lib/builderSave renderQuotePdf).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const escBr = (s) => esc(s).replace(/\r?\n/g, '<br>')
const fD = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fA = (n) => (Math.round((Number(n) || 0) * 100) % 100 === 0 ? '$' + Math.round(Number(n) || 0).toLocaleString('en-US') : fD(n))
const LONG = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
const sizeOf = (label) => { const m = /(\d+)\s*[x\xD7]\s*(\d+)/.exec(String(label || '')); return m ? `${m[1]}″ \xD7 ${m[2]}″ ` : '' }

/**
 * parts = lib/contractParts.generated.js ({ CONTRACT_CSS, SS_LOGO, CCI_LOGO, CCI_TERMS, SS_TERMS })
 * order = { number, date:'YYYY-MM-DD', d: additionDefaults(...), money: priceAddition(...), items: the box's rows,
 *           payMethod, notes }
 */
export function buildAdditionHtml(parts, order) {
  const { number, date, d, money, items = [], payMethod = '', notes = '' } = order
  const cci = d.mfr === 'CCI'
  const today = LONG(date)
  const name = d.name || 'Customer'

  // the program's _header: CCI = the badge + contact line only; CA = the full StormSafe header. The CCI terms page shows
  // Carolina Carports' logo instead of the badge (nothing beside it - the wide logo ran into the contact line).
  const header = (title, sub, logo) => '<div class="c-hdr">' +
    (logo
      ? '<img class="c-hdr-logo" src="' + logo + '" alt="Carolina Carports" style="width:190px;height:46px;object-fit:contain;object-position:left center">'
      : '<img class="c-hdr-logo" src="' + parts.SS_LOGO + '" alt="StormSafe">') +
    (logo ? '<div></div>' : '<div>' +
      (cci ? '' : '<div class="c-hdr-brand-name">STORM<span>SAFE</span> STEEL</div><div class="c-hdr-brand-tag">Where Durability Meets Peace of Mind</div>') +
      '<div class="c-hdr-brand-contact">561-771-5555 &bull; connect@stormsafesteel.com &bull; stormsafesteel.com</div></div>') +
    '<div class="c-hdr-meta"><div class="c-hdr-title">' + title + '</div>' +
    '<div class="c-hdr-sub"><strong>' + esc(number) + '</strong></div>' +
    '<div class="c-hdr-sub">Date: <strong>' + esc(today) + '</strong></div>' + (sub ? '<div class="c-hdr-sub">' + sub + '</div>' : '') +
    '</div></div>'
  const footer = (pn, tot) => '<div class="c-foot"><div><strong>StormSafe Steel</strong> &bull; ' + esc(number) + ' &bull; ' + esc(name) + '</div><div>Page ' + pn + ' of ' + tot + '</div></div>'
  const sigRow = (who) => '<div class="c-sig-block"><div class="c-sig-row r2"><div><div class="c-sig-line"></div><div class="c-sig-lbl">' + who + '</div></div><div><div class="c-sig-line"></div><div class="c-sig-lbl">Date</div></div></div></div>'

  // what is added, in words + where the framed-opening items go
  const adds = order.addsInWords || ''
  const framed = items.map((it, i) => ({ it, l: money.lines[i] })).filter((x) => x.it.kind === 'wtd' && x.it.framed && x.l)
  const framedTxt = framed.map(({ it, l }) => 'The walk-in door installs into the <strong>existing ' + esc(sizeOf(l.label)) + 'walk-through framed opening' +
    (it.wall ? ' on the ' + esc(String(it.wall).toLowerCase()) : '') + '</strong>.').join(' ')
  const signedTxt = [d.origSigned ? 'signed ' + esc(LONG(d.origSigned)) : '', d.building ? esc(d.building) : ''].filter(Boolean).join('; ')
  const addBox =
    '<div style="display:flex;gap:10px;margin:2px 0 8px"><div style="flex:1;background:#fff7ed;border:1.5px solid #f0883e;border-radius:6px;padding:8px 12px">' +
      '<div style="font-size:8pt;font-weight:900;letter-spacing:1.2px;color:#c2560f;text-transform:uppercase">Addition to an Existing Building</div>' +
      '<div style="font-size:8.3pt;color:#7c2d12;margin-top:3px;line-height:1.45">This order adds <strong>' + esc(adds || 'the items below') + '</strong> to the building on original order <strong>' + esc(d.root) + '</strong>' +
        (signedTxt ? ' (' + signedTxt + ')' : '') + '. ' + (framedTxt ? framedTxt + ' ' : '') + 'No other changes to the building.</div>' +
    '</div></div>'

  const spec = (l, v, hl) => '<div class="c-spec"><div class="l">' + l + '</div><div class="v' + (hl ? ' hl' : '') + '">' + v + '</div></div>'
  const specs = '<div class="c-sec"><div class="c-sec-title">Addition Details</div><div class="c-specs">' +
    spec('Adds', esc(adds ? adds.replace(/^./, (c) => c.toUpperCase()) : '—'), true) +
    spec('Existing Building', esc(d.building || '—')) +
    spec('Original Order', esc(d.root || '—')) +
    spec('Original Signed', esc(d.origSigned ? LONG(d.origSigned) : '—')) +
    spec('County', esc(d.county || '—')) +
    spec('Installed By', cci ? 'CCI Installer' : 'Manufacturer&rsquo;s Installer') +
    '</div></div>'

  const feeLbl = cci ? 'Addition Delivery Fee' : 'Addition Fee'
  const rows = money.lines.map((l) => '<tr><td class="li-desc">' + esc(l.desc) + '</td><td class="li-c">' + l.qty + '</td><td class="li-c">' + fA(l.unit) + '</td><td class="li-r">' + fA(l.amount) + '</td></tr>').join('') +
    (money.fee > 0 ? '<tr><td class="li-desc">' + feeLbl + ' &mdash; addition to an existing building (not taxed)</td><td class="li-c">1</td><td class="li-c">' + fA(money.fee) + '</td><td class="li-r">' + fA(money.fee) + '</td></tr>' : '')
  const table = '<div class="c-sec"><div class="c-sec-title">Itemized Pricing</div>' +
    '<table class="c-tbl"><thead><tr><th>Description</th><th class="c">Qty</th><th class="c">Unit</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table></div>'

  const pay = '<div class="c-sec c-pay-section"><div class="c-sec-title">Payment Summary</div><div class="c-totals-wrap">' +
    '<div class="c-tot-box">' +
      '<div class="c-tot-row"><span class="l">Items Subtotal</span><span class="v">' + fD(money.sub) + '</span></div>' +
      '<div class="c-tot-row"><span class="l">Sales Tax (' + (d.agx && !money.taxPct ? 'agricultural exempt' : money.taxPct + '%') + ')</span><span class="v">' + fD(money.tax) + '</span></div>' +
      (money.fee > 0 ? '<div class="c-tot-row"><span class="l">' + feeLbl + ' (not taxed)</span><span class="v">' + fD(money.fee) + '</span></div>' : '') +
      (!money.waived && payMethod ? '<div class="c-tot-row"><span class="l">Payment Method (deposit)</span><span class="v">' + esc(payMethod) + '</span></div>' : '') +
    '</div>' +
    '<div class="c-tot-box">' +
      (money.waived
        ? '<div class="c-pay-line dep"><span class="l">Deposit</span><span class="v" style="color:#15803d">WAIVED</span></div>'
        : '<div class="c-pay-line dep"><span class="l">Deposit Due Now (' + money.depPct + '%)</span><span class="v">' + fD(money.deposit) + '</span></div>') +
      '<div class="c-pay-line bal"><span class="l">Balance at Scheduling</span><span class="v">' + fD(money.balance) + '</span></div>' +
      '<div class="c-pay-line grand"><span class="l">Grand Total</span><span class="v">' + fD(money.total) + '</span></div>' +
    '</div>' +
  '</div></div>'

  const notesBox = String(notes || '').trim() ? '<div class="c-responsibilities" style="border-left-color:#f0883e"><strong>Notes:</strong> ' + escBr(String(notes).trim()) + '</div>' : ''
  const resp = '<div class="c-responsibilities"><strong>Buyer Responsibilities:</strong> Buyer must keep the work area' + (framed.length ? ' and the framed opening' : '') +
    ' clear and accessible for the installer on installation day. This order covers the items listed above and their installation only; it does not change the building&rsquo;s size.</div>'
  const ack = '<div class="c-ack">By signing below, Buyer acknowledges receipt of this Agreement and agrees to be bound by the Terms &amp; Conditions set forth on the following page. ' +
    '<span class="c-ack-warn">' + (money.waived ? 'No deposit is required on this order; the full balance is due as shown above.' : 'All deposits are non-refundable.') + '</span></div>'

  const card = (title, rowsHtml) => '<div class="c-card"><div class="c-card-title">' + title + '</div>' + rowsHtml + '</div>'
  const field = (l, v, style = '') => '<div class="c-field"><span class="l">' + l + '</span><span class="v"' + (style ? ' style="' + style + '"' : '') + '>' + v + '</span></div>'
  const parties = '<div class="c-sec"><div class="c-parties">' +
    card('Buyer / Billing',
      field('Name', esc(name)) + (d.phone ? field('Phone', esc(d.phone)) : '') + (d.email ? field('Email', esc(d.email), 'word-break:break-all') : '') +
      (d.billAddr ? field('Bill Addr', escBr(d.billAddr)) : '')) +
    card('Jobsite',
      (d.siteAddr ? field('Site Addr', escBr(d.siteAddr)) : '') + (d.county ? field('County', esc(d.county)) : '') +
      field('Building', 'Existing &mdash; order ' + esc(d.root || '—'))) +
  '</div></div>'

  const page1 = '<div class="page">' + header('Purchase Agreement &mdash; Addition', 'Addition to: <strong>' + esc(d.root || '—') + '</strong>') +
    parties + addBox + specs + table + pay + notesBox + resp + ack + sigRow('Buyer Signature') + footer(1, 2) + '</div>'
  const page2 = '<div class="page">' + header('Terms &amp; Conditions', '', cci ? parts.CCI_LOGO : null) +
    '<div class="c-tc-cols">' + (cci ? parts.CCI_TERMS : parts.SS_TERMS) + '</div>' +
    '<div class="c-ack" style="margin-top:10px"><strong>ACKNOWLEDGMENT &mdash;</strong> I HAVE READ AND AGREED TO ALL THE TERMS AND CONDITIONS STATED ABOVE AS RELATING TO THE PURCHASE OF SAID ' +
      'ADDITION FROM ' + (cci ? 'CAROLINA CARPORTS' : 'STORMSAFE STEEL') + '. I UNDERSTAND AND ACKNOWLEDGE THAT <strong>ALL PAYMENTS ARE NON-REFUNDABLE</strong>.</div>' +
    sigRow('Buyer Signature') + sigRow('Seller / StormSafe Rep') + footer(2, 2) + '</div>'

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(name) + ' - Addition Order ' + esc(number) + '</title><style>' + parts.CONTRACT_CSS + '</style></head><body>' +
    page1 + page2 + '</body></html>'
}
