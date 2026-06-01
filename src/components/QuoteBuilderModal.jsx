// QuoteBuilderModal: embeds the StormSafe quote builder (the proven QTEPRO
// engine, served same-origin at /quote-builder.html) in a full-screen modal.
//
// On "Save to CRM" it READS the builder — never modifies the engine or
// re-derives pricing:
//   • totals straight from the displayed Price Breakdown (#ptot/#pdep/#pbal),
//     so a saved total matches the builder to the dollar;
//   • the full serialized config via the builder's own collectQuoteData();
//   • the exact branded PDF, captured from printQuote() output (no popup).
// Then it maps onto a quotes row per CLAUDE_CODE_HANDOFF.md §5.3.

import { useRef, useState } from 'react'
import { uploadQuotePdfBlob } from '../lib/storage'
import {
  readBuilderTotals,
  buildSummary,
  capturePrintHtml,
  quoteNumberFromHtml,
  htmlToPdfBlob,
} from '../lib/quoteCapture'

const BUILDER_SRC = '/quote-builder.html'

export default function QuoteBuilderModal({ client, onSave, onClose }) {
  const iframeRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  // Best-effort seed of the plain-text contact inputs so the customer name
  // lands on the PDF. We don't seed building dimensions (that's the rep's job)
  // or anything that drives dependent selects.
  function handleLoad() {
    try {
      const win = iframeRef.current?.contentWindow
      const G = win?.G
      if (!G) return
      const setInput = (id, val) => {
        const el = G(id)
        if (el && val != null && val !== '' && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) el.value = val
      }
      setInput('cn', client?.name)
      setInput('cp', client?.phone)
      setInput('ce', client?.email)
      try { win.rc && win.rc() } catch { /* recalc is best-effort */ }
    } catch {
      /* If the builder isn't ready or blocks access, seeding is non-fatal. */
    }
  }

  async function handleSave() {
    setError('')
    setStatus('')
    setSaving(true)
    try {
      const win = iframeRef.current?.contentWindow
      if (!win || typeof win.collectQuoteData !== 'function' || typeof win.G !== 'function') {
        throw new Error('The builder is still loading — give it a moment and try again.')
      }

      const totals = readBuilderTotals(win)
      if (!totals.total) {
        throw new Error('No price yet — set a building width, length and height first.')
      }

      const data = win.collectQuoteData()
      const f = data?.fields || {}
      const mfrRaw = String(win.ACTIVE_MFR || '').toLowerCase()
      const manufacturer = mfrRaw === 'cci' ? 'cci' : mfrRaw === 'ca' ? 'ca' : 'other'
      const dims = [f.bw, f.bl, f.bh].filter(Boolean).join('x') || null
      const building_summary = buildSummary(win, data)

      // Capture the branded print document; reuse its SS-number so the DB row
      // and the PDF share one quote number.
      const printHtml = capturePrintHtml(win)
      const now = new Date()
      const quote_number =
        quoteNumberFromHtml(printHtml) || `SS-${now.getFullYear()}-${String(Date.now()).slice(-5)}`

      // Freeze the PDF into storage. Best-effort: a rasterization/upload hiccup
      // must not block saving the quote itself — the rep can attach it later.
      let pdf_snapshot_url = null
      let pdfWarning = ''
      try {
        if (printHtml) {
          setStatus('Generating PDF…')
          const blob = await htmlToPdfBlob(printHtml)
          pdf_snapshot_url = await uploadQuotePdfBlob(client.id, blob, `${quote_number}.pdf`)
        } else {
          pdfWarning = 'Quote saved, but the PDF could not be captured.'
        }
      } catch (pdfErr) {
        pdfWarning = `Quote saved, but the PDF could not be captured (${pdfErr.message}). You can attach it via Edit.`
      }

      const valid_through = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)

      // §5.3 mapping. total/deposit/balance are the builder's displayed numbers,
      // which already reconcile (deposit + balance = total) and match it to the
      // dollar. payload_json holds the full state for later PDF regeneration.
      const payload = {
        quote_date: now.toISOString().slice(0, 10),
        quote_number,
        manufacturer,
        building_summary,
        building_size: dims,
        total_amount: totals.total,
        deposit_amount: totals.deposit,
        balance_amount: totals.balance,
        status: 'draft',
        valid_through,
        pdf_snapshot_url,
        payload_json: {
          ...data,
          totals,
          manufacturer,
          quote_number,
          building_summary,
          source: 'qtepro-embed',
        },
        notes: null,
      }

      setStatus('Saving…')
      await onSave(payload)
      // onSave closes the modal on success. If the PDF failed, the quote still
      // saved cleanly — surface that as a non-blocking heads-up.
      if (pdfWarning) {
        // eslint-disable-next-line no-alert
        alert(pdfWarning)
      }
    } catch (err) {
      setError(err.message || 'Could not save the quote.')
      setSaving(false)
      setStatus('')
    }
  }

  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="Quote Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            Build Quote
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {error
            ? <div className="qb-bar-error">{error}</div>
            : status && <div className="qb-bar-status">{status}</div>}
          <div className="qb-bar-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save to CRM'}
            </button>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          src={BUILDER_SRC}
          title="StormSafe Quote Builder"
          className="qb-iframe"
          onLoad={handleLoad}
        />
      </div>
    </div>
  )
}
