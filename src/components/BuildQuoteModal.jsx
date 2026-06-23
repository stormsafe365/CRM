// BuildQuoteModal: opens the StormSafe 3D Builder (/build/build.html) full-screen
// for a lead. The builder hosts the QTEPRO pricing program (quote-builder.html)
// in its left pane — the same program the CRM already captures from. So we reach
// into that nested program window and:
//   • relabel its "SAVE QUOTE" button → "Save to Lead", and
//   • route the save to the CRM (capture totals + branded PDF → quotes row).
// A matching "Save to Lead" button in the top bar does the same, as a reliable
// fallback. Pricing/PDF come straight from the program — never re-derived here.

import { useEffect, useRef, useState } from 'react'
import { uploadQuotePdfBlob } from '../lib/storage'
import { readBuilderTotals, buildSummary, capturePrintHtml, quoteNumberFromHtml, htmlToPdfBlob } from '../lib/quoteCapture'
import { toast } from '../lib/uiFx'

const SRC = '/build/build.html'

// White "Save to Lead" button — white background, dark-navy text (matches the
// Generate Contract text color), so it reads clearly against the cyan buttons.
const SAVE_BTN = {
  background: '#ffffff',
  color: '#080f14',
  border: '1px solid #cdd6e0',
  boxShadow: '0 1px 3px rgba(0,0,0,.35)',
  fontWeight: 800,
}

export default function BuildQuoteModal({ client, onSave, onClose }) {
  const iframeRef = useRef(null)
  const savingRef = useRef(false)
  const [status, setStatus] = useState('')

  // The QTEPRO program lives in build.html's LEFT-pane iframe. Reach it (same-origin).
  function getProgramWindow() {
    try {
      const inner = iframeRef.current?.contentWindow?.document?.querySelector('iframe')
      const pg = inner?.contentWindow
      return pg && typeof pg.collectQuoteData === 'function' ? pg : null
    } catch { return null }
  }

  async function saveToLead() {
    if (savingRef.current) return
    const pg = getProgramWindow()
    if (!pg) { toast('The builder is still loading — give it a moment and try again.'); return }
    if (!client?.id) { toast('Open this from a lead to save the quote.'); return }
    savingRef.current = true
    setStatus('Reading quote…')
    try {
      const totals = readBuilderTotals(pg)
      if (!totals.total) {
        toast('No price yet — set a width, length and height first.')
        setStatus(''); savingRef.current = false; return
      }
      const data = pg.collectQuoteData()
      const f = data?.fields || {}
      const mfrRaw = String(pg.ACTIVE_MFR || '').toLowerCase()
      const manufacturer = mfrRaw === 'cci' ? 'cci' : mfrRaw === 'ca' ? 'ca' : 'other'
      const dims = [f.bw, f.bl, f.bh].filter(Boolean).join('x') || null
      const building_summary = buildSummary(pg, data)
      const printHtml = capturePrintHtml(pg)
      const now = new Date()
      const quote_number = quoteNumberFromHtml(printHtml) || `SS-${now.getFullYear()}-${String(Date.now()).slice(-5)}`

      let pdf_snapshot_url = null
      let pdfWarn = ''
      try {
        if (printHtml) {
          setStatus('Generating PDF…')
          const blob = await htmlToPdfBlob(printHtml)
          pdf_snapshot_url = await uploadQuotePdfBlob(client.id, blob, `${quote_number}.pdf`)
        } else { pdfWarn = 'Quote saved, but the PDF could not be captured.' }
      } catch (e) { pdfWarn = `Quote saved, but the PDF could not be captured (${e.message}).` }

      const valid_through = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10)
      const payload = {
        quote_date: now.toISOString().slice(0, 10),
        quote_number, manufacturer, building_summary, building_size: dims,
        total_amount: totals.total, deposit_amount: totals.deposit, balance_amount: totals.balance,
        status: 'draft', valid_through, pdf_snapshot_url,
        payload_json: { ...data, totals, manufacturer, quote_number, building_summary, source: '3d-builder' },
        notes: null,
      }
      setStatus('Saving…')
      await onSave(payload)
      setStatus('')
      savingRef.current = false
      toast(pdfWarn || `Quote ${quote_number} saved to ${client.name || 'lead'}`, pdfWarn ? undefined : 'success')
    } catch (e) {
      setStatus(''); savingRef.current = false
      toast(e.message || 'Could not save the quote.')
    }
  }

  // Once the nested program is ready, relabel its SAVE QUOTE button(s) → "Save to
  // Lead" and route their click to the CRM save. Polls (the program loads async).
  useEffect(() => {
    // Route the program's SAVE QUOTE (and "Save Current Quote") click to the CRM
    // save when used from a lead. The button's WHITE styling comes from the
    // program itself now, so we don't touch its appearance — just its action.
    const tick = () => {
      const pg = getProgramWindow()
      if (!pg) return
      const btns = [...pg.document.querySelectorAll('button')].filter((b) =>
        /saveQuote/.test(b.getAttribute('onclick') || '') || /save current quote/i.test(b.textContent || ''),
      )
      btns.forEach((b) => {
        if (b.dataset.ssHooked === '1') return
        b.dataset.ssHooked = '1'
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); saveToLead() }, true)
      })
    }
    const t = setInterval(tick, 600)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="3D Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            3D Builder
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>
                Build &amp; price, then hit <b>Save to Lead</b> — saves the quote + PDF to this lead.
              </div>}
          <div className="qb-bar-actions">
            <a className="btn-secondary" href={SRC} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in new tab</a>
            <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
            <button type="button" className="btn-primary" style={SAVE_BTN} onClick={saveToLead} disabled={!!status}>{status ? 'Saving…' : '💾 Save to Lead'}</button>
          </div>
        </div>
        <iframe ref={iframeRef} src={SRC} title="StormSafe 3D Builder" allow="fullscreen" className="qb-iframe" />
      </div>
    </div>
  )
}
