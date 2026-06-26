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

export default function BuildQuoteModal({ client, initialQuote, onSave, onClose }) {
  // When reopening a saved builder quote, its full state lives in payload_json.
  const restoreData = initialQuote?.payload_json?.fields ? initialQuote.payload_json : null
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

  // Prefill the program's Client Information from the lead, once — name, phone,
  // email and ZIP. We set each input and fire the program's OWN handlers (sy /
  // doZip) so it behaves exactly as if typed: the quote/PDF picks up the contact
  // info and the ZIP resolves city/county/state. We never overwrite a field the
  // user already filled, and never touch the program's source.
  // Reopen a saved quote: once the program is ready, restore its full state
  // (fields, doors, windows, lean-tos, manufacturer) via the program's own
  // restoreQuoteData — which also re-syncs the 3D model and reprices. From here
  // the user can adjust and re-save, or hit the program's Generate Contract.
  useEffect(() => {
    if (!restoreData) return
    let done = false
    const t = setInterval(() => {
      if (done) return
      const pg = getProgramWindow()
      if (!pg || typeof pg.restoreQuoteData !== 'function') return
      try { pg.restoreQuoteData(restoreData) } catch (e) { console.warn('restore failed', e) }
      done = true
      clearInterval(t)
      toast(`Loaded quote ${initialQuote?.quote_number || ''} — adjust and re-save`.trim(), 'success')
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!client || restoreData) return // editing a saved quote already carries its own client info
    let done = false
    const t = setInterval(() => {
      if (done) return
      const pg = getProgramWindow()
      const d = pg?.document
      if (!pg || !d || !d.getElementById('cn')) return // program not ready yet
      const set = (id, val) => { const el = d.getElementById(id); if (el && !el.value && val) el.value = String(val) }
      set('cn', client.name)
      set('cp', client.phone)
      set('ce', client.email)
      try { if (typeof pg.sy === 'function') pg.sy() } catch { /* ignore */ }
      const zipEl = d.getElementById('zip')
      const zip = client.zip ? String(client.zip).replace(/\D/g, '').slice(0, 5) : ''
      if (zipEl && !zipEl.value && zip) {
        zipEl.value = zip
        try { if (typeof pg.doZip === 'function') pg.doZip(zip) } catch { /* ignore */ }
      }
      done = true
      clearInterval(t)
      toast('Client info filled in from the lead', 'success')
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

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
            {restoreData ? `Editing Quote${initialQuote?.quote_number ? ` #${initialQuote.quote_number}` : ''}` : '3D Builder'}
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>
                {restoreData
                  ? <>Adjust the build, then <b>Save to Lead</b> to update this quote.</>
                  : <>Build &amp; price, then hit <b>Save to Lead</b> — saves the quote + PDF to this lead.</>}
              </div>}
          <div className="qb-bar-actions">
            <a className="btn-secondary" href={SRC} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in new tab</a>
            <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
            <button type="button" className="btn-primary" style={SAVE_BTN} onClick={saveToLead} disabled={!!status}>{status ? 'Saving…' : restoreData ? '💾 Update Quote' : '💾 Save to Lead'}</button>
          </div>
        </div>
        <iframe ref={iframeRef} src={SRC} title="StormSafe 3D Builder" allow="fullscreen" className="qb-iframe" />
      </div>
    </div>
  )
}
