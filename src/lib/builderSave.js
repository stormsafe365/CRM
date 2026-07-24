// builderSave.js — the shared "harvest the 3D builder and save a quote" flow.
// Used by BuildQuoteModal (per-lead) AND the standalone 3D Builder tab's
// Save-to-lead. Reads the QTEPRO pricing program window, captures totals, the
// live 3D thumbnail and the branded quote PDF, uploads the PDF to the lead's
// documents, then hands the assembled quote payload to `onSave` (the caller
// does the actual DB write). Pricing/PDF come straight from the program —
// never re-derived here.

import { uploadClientDocBlob, deleteDoc } from './storage'
import { readBuilderTotals, buildSummary, capturePrintHtml, dataUrlToThumb, quoteNumberFromHtml, htmlToPdfBlob } from './quoteCapture'

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

// `pg` = the pricing-program window (quote-builder.html), `buildWin` = the
// build.html window that hosts it (for the 3D capture hook). Throws on hard
// failures; returns { quote_number, pdfWarn } on success ('' when the PDF
// captured cleanly).
export async function harvestAndSaveQuote({ pg, buildWin, client, initialQuote = null, onSave, setStatus = () => {} }) {
  const totals = readBuilderTotals(pg)
  if (!totals.total) throw new Error('No price yet — set a width, length and height first.')

  const data = pg.collectQuoteData()
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

  // Card display fields (colors / foundation / type) read from the program.
  const optText = (id) => {
    const el = pg.document.getElementById(id)
    if (!el || el.selectedIndex < 0) return null
    const t = (el.options[el.selectedIndex]?.text || '').trim()
    return t && t !== '—' ? t : null
  }
  const colorName = (id) => { const t = optText(id); return t ? t.replace(/\s*\(.*\)\s*$/, '').trim() : null }
  const card = { roofColor: colorName('cr'), wallColor: colorName('cw'), foundation: optText('foundation'), buildingType: optText('btype') }

  setStatus('Capturing quote…')
  const printHtml = await capturePrintHtml(pg)
  const now = new Date()
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

  const valid_through = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  const payload = {
    quote_date: now.toISOString().slice(0, 10),
    quote_number, manufacturer, building_summary, building_size: dims,
    total_amount: totals.total, deposit_amount: totals.deposit, balance_amount: totals.balance,
    status: 'draft', valid_through, pdf_snapshot_url,
    payload_json: { ...data, totals, manufacturer, quote_number, building_summary, source: '3d-builder', rendering_thumb, card },
    notes: null,
  }
  setStatus('Saving…')
  await onSave(payload)
  // Replaced an existing quote's PDF → remove the old file so the Document Hub
  // keeps ONE PDF per quote (named with the quote's number), not a stale pile.
  if (initialQuote?.pdf_snapshot_url && initialQuote.pdf_snapshot_url !== pdf_snapshot_url) {
    try { await deleteDoc(initialQuote.pdf_snapshot_url) } catch { /* ignore */ }
  }
  // Tell the Document Hub (Storage has no realtime) a new quote file landed.
  try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
  return { quote_number, pdfWarn }
}
