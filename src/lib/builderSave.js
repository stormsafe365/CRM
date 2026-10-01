// builderSave.js — the shared "harvest the 3D builder and save a quote" flow.
// Used by BuildQuoteModal (per-lead) AND the standalone 3D Builder tab's
// Save-to-lead. Reads the QTEPRO pricing program window, captures totals, the
// live 3D thumbnail and the branded quote PDF, uploads the PDF to the lead's
// documents, then hands the assembled quote payload to `onSave` (the caller
// does the actual DB write). Pricing/PDF come straight from the program —
// never re-derived here.

import { uploadClientDocBlob } from './storage'
import { readBuilderTotals, buildSummary, capturePrintHtml, dataUrlToThumb, quoteNumberFromHtml, htmlToPdfBlob } from './quoteCapture'
import { appendPriceHistory, planQuoteFields, savedTotalsOf, totalsDiffer, withPrintCheck } from './priceLockCrm'

// Render the captured quote document to a PDF blob. Prefer Electron's native
// print-to-PDF (honors the quote's print styles + dark theme exactly like the
// builder's own working "Save / Print PDF"); fall back to html2pdf in a browser.
export async function renderQuotePdf(printHtml) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (api && typeof api.renderPdf === 'function') {
    const b64 = await api.renderPdf(printHtml)
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      return new Blob([bytes], { type: 'application/pdf' })
    }
  }
  return htmlToPdfBlob(printHtml)
}

// Read everything a saved quote row carries from the program: the on-screen
// totals, the build config (collectQuoteData), the price snapshot, the card
// fields and the 3D thumbnail. Shared by the normal save and Finish Revision.
//
// Price lock (owner 9/30/26: "make sure i can reopen that quote exactly as it
// was"): payload_json.priced = PriceLock.snapshot() — what this quote costs
// right now — so reopening holds this exact price. It is taken HERE, never
// inside collectQuoteData (which other callers use). payload_json.price_history
// carries forward every version this save replaces (totals, PDF path, config).
export async function harvestQuoteState({ pg, buildWin, initialQuote = null, reason = 'update', setStatus = () => {} }) {
  const totals = readBuilderTotals(pg)
  if (!totals.total) throw new Error('No price yet — set a width, length and height first.')

  const data = pg.collectQuoteData()
  let priced = null
  try {
    if (pg.PriceLock && typeof pg.PriceLock.snapshot === 'function') priced = pg.PriceLock.snapshot() || null
  } catch (e) { console.warn('price snapshot failed', e) }
  if (priced && priced.money && totalsDiffer(totals, { total: priced.money.adjTot, deposit: priced.money.dep, balance: priced.money.bal })) {
    console.warn('price snapshot differs from the Price Breakdown — saving both', { totals, money: priced.money })
  }

  const f = data?.fields || {}
  const mfrRaw = String(pg.ACTIVE_MFR || '').toLowerCase()
  const manufacturer = mfrRaw === 'cci' ? 'cci' : mfrRaw === 'ca' ? 'ca' : 'other'
  const dims = [f.bw, f.bl, f.bh].filter(Boolean).join('x') || null
  const building_summary = buildSummary(pg, data)

  // Snapshot the live 3D iso view as a small thumbnail for the quote card.
  // Best-effort: a save must never fail because the capture didn't work.
  let rendering_thumb = null
  try {
    if (buildWin && typeof buildWin.__ssCapture3D === 'function') {
      setStatus('Capturing 3D…')
      const shots = await buildWin.__ssCapture3D()
      rendering_thumb = await dataUrlToThumb(shots?.iso)
    }
  } catch { /* rendering is optional */ }
  // Keep the card's existing picture rather than blanking it when a capture fails.
  if (!rendering_thumb) rendering_thumb = initialQuote?.payload_json?.rendering_thumb || null

  // Card display fields (colors / foundation / type) read from the program.
  const optText = (id) => {
    const el = pg.document.getElementById(id)
    if (!el || el.selectedIndex < 0) return null
    const t = (el.options[el.selectedIndex]?.text || '').trim()
    return t && t !== '—' ? t : null
  }
  const colorName = (id) => { const t = optText(id); return t ? t.replace(/\s*\(.*\)\s*$/, '').trim() : null }
  const card = { roofColor: colorName('cr'), wallColor: colorName('cw'), foundation: optText('foundation'), buildingType: optText('btype') }

  const price_history = appendPriceHistory({ initialQuote, reason, next: totals })
  const payload_json = {
    ...data,
    ...(priced ? { priced } : {}),
    totals, manufacturer, building_summary, source: '3d-builder', rendering_thumb, card,
    ...(price_history.length ? { price_history } : {}),
  }
  return { totals, data, payload_json, manufacturer, building_summary, building_size: dims }
}

// Finish Revision: the revised build, totals and price history for the SAME
// quote row. Status, validity, notes and the quote PDF are left as they are.
export async function harvestRevisionUpdate({ pg, buildWin, initialQuote, setStatus = () => {} }) {
  const st = await harvestQuoteState({ pg, buildWin, initialQuote, reason: 'revision', setStatus })
  return {
    manufacturer: st.manufacturer,
    building_summary: st.building_summary,
    building_size: st.building_size,
    total_amount: st.totals.total, deposit_amount: st.totals.deposit, balance_amount: st.totals.balance,
    payload_json: { ...st.payload_json, quote_number: initialQuote?.quote_number || st.payload_json.quote_number },
  }
}

// `pg` = the pricing-program window (quote-builder.html), `buildWin` = the
// build.html window that hosts it (for the 3D capture hook). Throws on hard
// failures; returns { quote_number, pdfWarn, payload } on success (pdfWarn is
// '' when the PDF captured cleanly; payload is what onSave wrote).
export async function harvestAndSaveQuote({ pg, buildWin, client, initialQuote = null, onSave, setStatus = () => {} }) {
  const { totals, payload_json, manufacturer, building_summary, building_size: dims } =
    await harvestQuoteState({ pg, buildWin, initialQuote, reason: 'update', setStatus })

  setStatus('Capturing quote…')
  const printHtml = await capturePrintHtml(pg)
  const now = new Date()
  // Snapshot check: the quote PDF's Building Amount should equal the priced
  // subtotal. A divergence is logged and recorded on the snapshot; the save goes on.
  if (payload_json.priced) {
    payload_json.priced = withPrintCheck(payload_json.priced, printHtml)
    if (payload_json.priced.printDiverged) {
      console.warn('quote PDF subtotal differs from the priced subtotal', { printSub: payload_json.priced.printSub, sub: payload_json.priced.sub })
    }
  }
  // Keep the quote's EXISTING number when editing, so the DB row, the card,
  // and the PDF filename in the Document Hub all show the same number. Only a
  // brand-new quote takes the number stamped into the freshly printed quote.
  const quote_number = initialQuote?.quote_number
    || quoteNumberFromHtml(printHtml)
    || `SS-${now.getFullYear()}-${String(Date.now()).slice(-5)}`

  let pdf_snapshot_url = null
  let pdfWarn = ''
  try {
    if (printHtml) {
      setStatus('Generating PDF…')
      const blob = await renderQuotePdf(printHtml)
      // Save under the 'quote' category so it also lands in Document Hub › Quotes.
      pdf_snapshot_url = await uploadClientDocBlob(client.id, 'quote', blob, `${quote_number}.pdf`, 'application/pdf')
    } else { pdfWarn = 'Quote saved, but the PDF could not be captured.' }
  } catch (e) { pdfWarn = `Quote saved, but the PDF could not be captured (${e.message}).` }
  // No new PDF on a re-save: keep the card's existing quote PDF when the price is
  // unchanged (it still shows this price). When the price changed, the old PDF
  // no longer matches the card — it stays in Documents and price_history, but is
  // not presented as the current quote.
  if (!pdf_snapshot_url && initialQuote?.pdf_snapshot_url
    && !totalsDiffer(savedTotalsOf(initialQuote), totals)) {
    pdf_snapshot_url = initialQuote.pdf_snapshot_url
  }

  // New quote: draft, valid 30 days, no notes. Re-save of an existing quote:
  // a sold status (verbal accept / deposit paid / revised) and the notes are
  // KEPT; a price change sends an unsold quote back to draft (planQuoteFields).
  const payload = {
    quote_date: now.toISOString().slice(0, 10),
    quote_number, manufacturer, building_summary, building_size: dims,
    total_amount: totals.total, deposit_amount: totals.deposit, balance_amount: totals.balance,
    ...planQuoteFields({ initialQuote, totals, now }),
    pdf_snapshot_url,
    payload_json: { ...payload_json, quote_number },
  }
  setStatus('Saving…')
  await onSave(payload)
  // The previous quote PDF is KEPT (it used to be deleted here): it is the
  // frozen record of what the customer was quoted before this save. Its path
  // is in payload_json.price_history.
  // Tell the Document Hub (Storage has no realtime) a new quote file landed.
  try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
  return { quote_number, pdfWarn, payload }
}
