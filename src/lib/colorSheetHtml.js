// colorSheetHtml.js — manufacturer color-selection sheet for StormSafe Steel.
// Clients often order with colors "TBD"; when they finally choose, the rep
// generates this sheet and sends it to the manufacturer (Carolina Carports /
// Carports Anywhere) so the order gets built in the right colors. Rendered to
// PDF through the same Electron print path as receipts (lib/builderSave
// renderQuotePdf). Print-friendly light theme — swatches must print true, so
// print-color-adjust is forced on.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return String(iso) }
}

// ── Manufacturer color palettes ──────────────────────────────────────────────
// Mirrors of the 3D builder's MANUFACTURERS[...].colors charts (quote-builder
// per-mfr config). n = color name, c = manufacturer color code (CA only —
// CCI's chart is by name), h = on-screen hex used by the builder's dropdowns
// (also how a saved quote's cr/cw/ct/cwn values are matched back to a name).
export const CA_COLORS = [
  { n: 'Charcoal', c: 'WXA0090L', h: '#6B6360' },
  { n: 'Light Gray', c: 'WXA0095L', h: '#9EA5A8' },
  { n: 'Black', c: 'WXA0107L', h: '#1A1A1A' },
  { n: 'Cocoa Brown', c: 'WXB1008L', h: '#5C3A2E' },
  { n: 'Light Stone', c: 'WXD0038L', h: '#C9B99A' },
  { n: 'Ivory', c: 'WXD0045L', h: '#EDD5C0' },
  { n: 'Sahara Tan', c: 'WXD0046L', h: '#B8956A' },
  { n: 'Clay', c: 'WXD0047L', h: '#9E8880' },
  { n: 'Hawaiian Blue', c: 'WXL0027L', h: '#3A6B8A' },
  { n: 'Barn Red', c: 'WXR0077L', h: '#7D3030' },
  { n: 'Bright White', c: 'WXD0049L', h: '#DDDDE8' },
  { n: 'Arctic White', c: '', h: '#CFD0C6' },
  { n: 'Ivy Green', c: 'WXG0020L', h: '#1E4D3A' },
  { n: 'Bright Red', c: 'WXR0084', h: '#BC1E2D' },
  { n: 'Burnished Slate', c: 'WXB107L', h: '#555A4A' },
  { n: 'Galvalume', c: 'GALVALUME', h: '#B8BDC2' },
  { n: 'Burgundy', c: 'WXR0081L', h: '#4A1E2A' },
  { n: 'Copper Penny', c: 'KM2Y49352', h: '#C47F2A' },
]

// Hexes resampled 2026-08-25 from CCI's official color chart photo.
export const CCI_COLORS = [
  { n: 'White', h: '#F2F1EA' },
  { n: 'Galvalume', h: '#B9BCBB' },
  { n: 'Black', h: '#1D1E20' },
  { n: 'Quaker Gray', h: '#57534A' },
  { n: 'Pewter Gray', h: '#8A8A88' },
  { n: 'Earth Brown', h: '#74472A' },
  { n: 'Evergreen', h: '#2C5745' },
  { n: 'Slate Blue', h: '#4A7191' },
  { n: 'King Blue', h: '#2591CE' },
  { n: 'Cardinal Red', h: '#D8291D' },
  { n: 'Barn Red', h: '#A63A20' },
  { n: 'Merlot', h: '#5C2320' },
  { n: 'Burgundy', h: '#46201F' },
  { n: 'Tan', h: '#B18F6C' },
  { n: 'Clay', h: '#A8977E' },
  { n: 'Sandstone', h: '#D2C4A0' },
  { n: 'Pebble Beige', h: '#DBD1B0' },
]

/** Pre-resample CCI hexes (what older saved quotes carry) → corrected hexes. */
const CCI_LEGACY_HEX = {
  '#f4f1ec': '#F2F1EA', '#b8bdc2': '#B9BCBB', '#1a1a1a': '#1D1E20',
  '#52524f': '#57534A', '#7a7d7f': '#8A8A88', '#4f3a2e': '#74472A',
  '#1f4231': '#2C5745', '#3a5e7a': '#4A7191', '#1b7ab4': '#2591CE',
  '#d62a1f': '#D8291D', '#a2392b': '#A63A20', '#5d2a2e': '#5C2320',
  '#4b1a23': '#46201F', '#b7986a': '#B18F6C', '#a99172': '#A8977E',
  '#ccbc9d': '#D2C4A0', '#d6c8a5': '#DBD1B0',
}

/** Palette + display identity for a quote's manufacturer. */
export function paletteFor(manufacturer) {
  const m = String(manufacturer || '').toLowerCase()
  if (m === 'cci') return { list: CCI_COLORS, mfrName: 'Carolina Carports, Inc.', mfrShort: 'Carolina Carports' }
  if (m === 'ca') return { list: CA_COLORS, mfrName: 'Carports Anywhere', mfrShort: 'Carports Anywhere' }
  return { list: CA_COLORS, mfrName: null, mfrShort: null }
}

/** Match a saved builder color value (hex like '#6B6360') back to a palette entry. */
export function matchSavedColor(list, savedHex) {
  let v = String(savedHex || '').trim().toLowerCase()
  if (!v || v === 'tbd') return null
  if (CCI_LEGACY_HEX[v]) v = CCI_LEGACY_HEX[v].toLowerCase()
  return list.find((c) => c.h.toLowerCase() === v) || null
}

/**
 * data = {
 *   client: { name, email, phone, city, state },
 *   quote:  { quote_number, building_size, building_summary, manufacturer },
 *   sheet:  { number, date (yyyy-mm-dd), roof, walls, trim, wainscot, note }
 *           — roof/walls/trim/wainscot are palette entries {n, c?, h} (wainscot
 *             null/undefined when the build has none).
 * }
 */
export function buildColorSheetHtml({ client = {}, quote = {}, sheet = {} }) {
  const { mfrName } = paletteFor(quote.manufacturer)
  const building = [quote.building_size, quote.building_summary].filter(Boolean).join(' — ')
  const surfaces = [
    ['Roof', sheet.roof],
    ['Walls', sheet.walls],
    ['Trim', sheet.trim],
    sheet.wainscot ? ['Wainscot', sheet.wainscot] : null,
  ].filter(Boolean)

  const row = ([surface, col]) => `
    <div class="crow">
      <div class="sw" style="background:${esc(col.h)}"></div>
      <div class="cmeta">
        <div class="surf">${esc(surface)}</div>
        <div class="cname">${esc(col.n)}</div>
        ${col.c ? `<div class="ccode">Color code <b>${esc(col.c)}</b></div>` : ''}
      </div>
      <div class="chip-ok">✓ Selected</div>
    </div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(sheet.number || 'Color Selection Sheet')} — StormSafe Steel</title>
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
    font-size: 10.5pt; line-height: 1.55;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #22d3c8; }
  .wordmark { font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 21pt; letter-spacing: .04em; text-transform: uppercase; color: #0f172a; }
  .wordmark .safe { color: #0d9488; }
  .tagline { color: #64748b; font-size: 8.5pt; margin-top: 4px; letter-spacing: .02em; }
  .doc-type { text-align: right; }
  .doc-type .t { font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 15pt; letter-spacing: .08em; text-transform: uppercase; color: #0d9488; }
  .doc-type .n { font-size: 9.5pt; color: #64748b; margin-top: 6px; }
  .doc-type .n b { color: #0f172a; font-weight: 600; }

  .to-band { margin: 16px 0 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #0d9488; border-radius: 8px; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .to-band .to { font-size: 11pt; }
  .to-band .to b { font-family: 'Orbitron', sans-serif; font-size: 11pt; letter-spacing: .04em; }
  .to-band .from { font-size: 9pt; color: #64748b; text-align: right; }

  .cols { display: flex; gap: 20px; margin-bottom: 14px; }
  .panel { flex: 1; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px 18px; }
  .panel h3 { font-family: 'Orbitron', sans-serif; font-size: 8.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f766e; margin-bottom: 8px; }
  .panel .big { font-size: 12pt; font-weight: 600; color: #0f172a; }
  .panel .meta { color: #64748b; font-size: 9.5pt; margin-top: 2px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }
  .kv:last-child { border-bottom: 0; }
  .kv .k { color: #64748b; }
  .kv .v { color: #0f172a; font-weight: 600; text-align: right; }

  .sec-t { font-family: 'Orbitron', sans-serif; font-size: 10pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #0f172a; margin: 2px 0 8px; }
  .crow { display: flex; align-items: center; gap: 18px; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 16px; margin-bottom: 8px; background: #ffffff; }
  .sw { width: 1.35in; height: 0.6in; border-radius: 8px; border: 1px solid #94a3b8; flex: none; box-shadow: inset 0 0 0 3px #ffffff; }
  .cmeta { flex: 1; }
  .surf { font-family: 'Orbitron', sans-serif; font-size: 8pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #0f766e; }
  .cname { font-family: 'Orbitron', sans-serif; font-size: 14pt; font-weight: 700; letter-spacing: .03em; color: #0f172a; margin-top: 2px; }
  .ccode { font-size: 9pt; color: #64748b; margin-top: 2px; }
  .ccode b { color: #0f172a; font-weight: 600; }
  .chip-ok { font-size: 8.5pt; font-weight: 700; letter-spacing: .06em; color: #0f766e; background: rgba(34,211,200,.10); border: 1px solid #22d3c8; border-radius: 99px; padding: 4px 12px; white-space: nowrap; }

  .note { background: #f0fdfa; border-left: 3px solid #0d9488; border-radius: 0 8px 8px 0; padding: 9px 14px; font-size: 9.5pt; color: #334155; margin: 12px 0 0; }

  .sig { display: flex; gap: 28px; margin-top: 20px; }
  .sig .box { flex: 1.6; }
  .sig .box.sm { flex: 1; }
  .sig .line { border-bottom: 1.5px solid #0f172a; height: 30px; }
  .sig .cap { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #64748b; margin-top: 5px; }

  .foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
  .foot .co { font-size: 8.5pt; color: #64748b; line-height: 1.7; }
  .foot .co b { color: #0f172a; }
  .foot .legal { font-size: 7.5pt; color: #64748b; text-align: right; max-width: 3.6in; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="wordmark">Storm<span class="safe">Safe</span> Steel</div>
      <div class="tagline">Hurricane-Rated Steel Buildings · West Palm Beach, FL</div>
    </div>
    <div class="doc-type">
      <div class="t">Color Selection</div>
      <div class="n">Sheet <b>${esc(sheet.number || '—')}</b></div>
      <div class="n">Issued <b>${esc(fmtDate(sheet.date))}</b></div>
    </div>
  </div>

  <div class="to-band">
    <div class="to">${mfrName ? `To: <b>${esc(mfrName)}</b>` : 'Final color selections for the order below'}</div>
    <div class="from">Submitted by <b>StormSafe Steel</b>${mfrName ? ' — Authorized Dealer' : ''}</div>
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
      <h3>Order</h3>
      ${quote.quote_number ? `<div class="kv"><span class="k">Quote / Order #</span><span class="v">${esc(quote.quote_number)}</span></div>` : ''}
      ${mfrName ? `<div class="kv"><span class="k">Manufacturer</span><span class="v">${esc(mfrName)}</span></div>` : ''}
      ${building ? `<div class="kv"><span class="k">Building</span><span class="v">${esc(building)}</span></div>` : ''}
      <div class="kv"><span class="k">Colors selected</span><span class="v">${esc(fmtDate(sheet.date))}</span></div>
    </div>
  </div>

  <div class="sec-t">Final Color Selections</div>
  ${surfaces.map(row).join('')}

  ${sheet.note ? `<div class="note">${esc(sheet.note)}</div>` : ''}

  <div class="sig">
    <div class="box">
      <div class="line"></div>
      <div class="cap">Customer Signature — ${esc(client.name || 'Customer')}</div>
    </div>
    <div class="box sm">
      <div class="line"></div>
      <div class="cap">Date</div>
    </div>
  </div>

  <div class="foot">
    <div class="co">
      <b>StormSafe Steel</b><br>
      8480 Okeechobee Blvd, Suite 5 · West Palm Beach, FL 33411<br>
      (561) 771-5555 · ops@stormsafesteel.com · stormsafesteel.com
    </div>
    <div class="legal">
      These selections are final for manufacturing and supersede any prior
      &ldquo;TBD&rdquo; color choices on the referenced order. Printed swatches are
      approximations — final panel colors follow the manufacturer's standard
      color chart${mfrName ? ` (${esc(mfrName)})` : ''}.
    </div>
  </div>
</body>
</html>`
}

/** Document number: CLR + quote number, date-stamped (mirrors makeReceiptNumber). */
export function makeColorSheetNumber(quote) {
  const base = quote?.quote_number ? String(quote.quote_number).replace(/^SS-?/, '') : null
  const stamp = new Date()
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
  return base ? `CLR-${base}-${ymd}` : `CLR-${ymd}-${String(Date.now()).slice(-4)}`
}
