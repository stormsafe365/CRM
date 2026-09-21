// BuildQuoteModal: opens the StormSafe 3D Builder (/build/build.html) full-screen
// for a lead. The builder hosts the QTEPRO pricing program (quote-builder.html)
// in its left pane — the same program the CRM already captures from. So we reach
// into that nested program window and:
//   • relabel its "SAVE QUOTE" button → "Save to Lead", and
//   • route the save to the CRM (capture totals + branded PDF → quotes row).
// A matching "Save to Lead" button in the top bar does the same, as a reliable
// fallback. Pricing/PDF come straight from the program — never re-derived here.

import { useEffect, useRef, useState } from 'react'
import SaveToLeadPicker from './SaveToLeadPicker'
import { uploadClientDocBlob } from '../lib/storage'
import { captureContractHtml, quoteNumberFromHtml } from '../lib/quoteCapture'
import { harvestAndSaveQuote, renderQuotePdf } from '../lib/builderSave'
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

export default function BuildQuoteModal({ client, initialQuote, onSave, onClose, autoContract = false, autoExec = false, revisionChanges = null }) {
  // When reopening a saved builder quote, its full state lives in payload_json.
  const restoreData = initialQuote?.payload_json?.fields ? initialQuote.payload_json : null
  const iframeRef = useRef(null)
  const savingRef = useRef(false)
  const [status, setStatus] = useState('')
  // Opened WITHOUT a lead (e.g. Dashboard → New Quote): Save to Lead opens the
  // shared picker to attach to an existing lead or create a new one on the spot.
  const [picker, setPicker] = useState(false)
  const [savedTo, setSavedTo] = useState(null) // lead name after a picker save

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
    if (!client?.id) { setPicker(true); return } // no lead yet → pick or create one
    savingRef.current = true
    setStatus('Reading quote…')
    try {
      // Shared harvest+save flow (lib/builderSave) — also used by the
      // standalone 3D Builder tab's Save to Lead.
      const { quote_number, pdfWarn } = await harvestAndSaveQuote({
        pg,
        buildWin: iframeRef.current?.contentWindow,
        client,
        initialQuote,
        onSave,
        setStatus,
      })
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
      let ok = true
      try { pg.restoreQuoteData(restoreData) } catch (e) { ok = false; console.warn('restore failed', e) }
      done = true
      clearInterval(t)
      toast(
        ok ? (autoExec
              ? `Loaded quote ${initialQuote?.quote_number || ''} — generating executed copy…`.trim()
              : autoContract
              ? `Loaded quote ${initialQuote?.quote_number || ''} — generating contract…`.trim()
              : `Loaded quote ${initialQuote?.quote_number || ''} — adjust and re-save`.trim())
           : "Couldn't fully load this quote's saved build — please rebuild or check the console.",
        ok ? 'success' : undefined,
      )
      // "Generate Contract" / "Executed Copy" from a quote card: once the build is
      // fully restored and repriced, auto-run the same save-to-Doc-Hub + print flow
      // the rep would trigger by hand. The delay lets repricing finish first.
      if (ok && autoExec) {
        setStatus('Generating executed copy…')
        setTimeout(() => { saveExecutedThenPrint(getProgramWindow()) }, 1400)
      } else if (ok && autoContract) {
        setStatus('Generating contract…')
        setTimeout(() => { saveContractThenPrint(getProgramWindow()) }, 1400)
      } else if (ok && revisionChanges && revisionChanges.length) {
        // Revision flow: apply the modal's structured changes to the build
        // AFTER the program stashes its as-ordered snapshot (~900ms post-restore)
        // so the applied components count as NEW (highlighted on the revised
        // contract). The rep then drags placements and hits Generate Contract.
        setStatus('Applying revision changes…')
        setTimeout(() => { applyRevisionChanges(getProgramWindow(), revisionChanges) }, 1800)
      }
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

  // Apply the Revision modal's structured rows to the live build: add roll-ups
  // (with size, wall, hoist/seal/opener), walk doors, windows; remove matching
  // components; change building size. Anything it can't apply is reported so
  // the rep does that one by hand. Placement stays with the rep — drag it.
  function applyRevisionChanges(pg, changes) {
    if (!pg) return
    const d = pg.document
    const set = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new pg.Event('change', { bubbles: true })); return true }
    const skipped = []
    try {
      for (const r of changes) {
        if (r.type === 'size') {
          const to = String(r.to || '').replace(/×/g, 'x').match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i)
          if (to) {
            set(d.getElementById('bw'), to[1]); set(d.getElementById('bl'), to[2]); set(d.getElementById('bh'), to[3])
            try { pg.doBld() } catch { /* rc below */ }
          } else skipped.push('Size change — set Width/Length/Height by hand')
        } else if (r.type === 'add') {
          if (r.comp === 'Roll-Up Door' && typeof pg.aRUD === 'function') {
            pg.aRUD()
            const el = [...d.querySelectorAll('.re')].pop()
            if (r.size) set(el.querySelector('.rsz'), r.size)
            if (r.wall && r.wall !== '—') set(el.querySelector('.rloc'), r.wall)
            if (r.hoist && !r.hoistIncluded) set(el.querySelector('.rch'), '1')
            if (r.seal) set(el.querySelector('.rsl'), '1')
            if (r.opener) set(el.querySelector('.rop'), '1')
          } else if (r.comp === 'Walk-Through Door' && typeof pg.aWTD === 'function') {
            pg.aWTD()
            const el = [...d.querySelectorAll('.we')].pop()
            if (r.wall && r.wall !== '—') set(el.querySelector('.wloc'), r.wall)
          } else if (r.comp === 'Window' && typeof pg.aWIN === 'function') {
            pg.aWIN()
            const el = [...d.querySelectorAll('.ne')].pop()
            if (r.wall && r.wall !== '—') set(el.querySelector('.nloc'), r.wall)
          } else {
            skipped.push(`Add ${r.comp} — add it by hand`)
          }
        } else if (r.type === 'remove') {
          const sel = r.comp === 'Roll-Up Door' ? '.re' : r.comp === 'Walk-Through Door' ? '.we' : r.comp === 'Window' ? '.ne' : null
          let hit = null
          if (sel) {
            hit = [...d.querySelectorAll(sel)].find((el) => {
              const sz = (el.querySelector('.rsz') || {}).value || ''
              const loc = (el.querySelector('.rloc') || el.querySelector('.wloc') || el.querySelector('.nloc') || {}).value || ''
              return (!r.size || sz === r.size) && (!r.wall || r.wall === '—' || loc === r.wall)
            })
          }
          const rm = hit && hit.querySelector('button.rm')
          if (rm) rm.click()
          else skipped.push(`Remove ${r.comp}${r.size ? ' ' + r.size : ''} — remove it by hand`)
        }
      }
      try { pg.rc() } catch { /* ignore */ }
    } catch (e) { console.warn('apply revision changes failed', e) }
    setStatus('')
    toast(skipped.length
      ? `Changes applied — do these by hand: ${skipped.join('; ')}`
      : 'Revision changes applied to the building — drag placements, then hit GENERATE CONTRACT for the revised contract', 'success')
  }

  // Save a PDF copy of the contract to the Document Hub (Contracts), then let the
  // program generate it for the rep as usual.
  async function saveContractThenPrint(pg) {
    if (!pg) return
    try {
      if (client?.id) {
        setStatus('Saving contract…')
        const html = await captureContractHtml(pg)
        if (html && html.length > 3000) {
          const blob = await renderQuotePdf(html)
          const num = quoteNumberFromHtml(html) || `SS-${new Date().getFullYear()}`
          await uploadClientDocBlob(client.id, 'contract', blob, `${num}-contract.pdf`, 'application/pdf')
          try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
          toast(`Contract saved to ${client.name || 'lead'} · Documents › Contracts`, 'success')
        }
      }
    } catch (e) {
      console.warn('contract save failed', e)
    } finally {
      setStatus('')
    }
    try { pg.printContract() } catch (e) { toast('Could not open the contract: ' + (e.message || e)) }
  }

  // Executed Copy — Deposit Paid: same flow as saveContractThenPrint, but with the
  // builder's EXEC_COPY flag raised so both the Doc-Hub PDF and the printed copy
  // carry the logo + DEPOSIT PAID watermark and the "Deposit PAID" payment line.
  async function saveExecutedThenPrint(pg) {
    if (!pg) return
    try {
      if (client?.id) {
        setStatus('Saving executed copy…')
        pg.EXEC_COPY = true
        let html
        try { html = await captureContractHtml(pg) } finally { pg.EXEC_COPY = false }
        if (html && html.length > 3000) {
          const blob = await renderQuotePdf(html)
          const num = quoteNumberFromHtml(html) || `SS-${new Date().getFullYear()}`
          await uploadClientDocBlob(client.id, 'contract', blob, `${num}-executed-deposit-paid.pdf`, 'application/pdf')
          try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
          toast(`Executed copy saved to ${client.name || 'lead'} · Documents › Contracts`, 'success')
        }
      }
    } catch (e) {
      console.warn('executed copy save failed', e)
    } finally {
      setStatus('')
    }
    try { pg.printExecutedCopy() } catch (e) { toast('Could not open the executed copy: ' + (e.message || e)) }
  }

  // Hook the program's GENERATE CONTRACT button so it also saves to the Doc Hub.
  // Capture-phase + stopImmediatePropagation blocks the inline onclick so it
  // doesn't also fire (which would double-open and race the silent capture).
  useEffect(() => {
    const tick = () => {
      const pg = getProgramWindow()
      if (!pg || !pg.document) return
      const btns = [...pg.document.querySelectorAll('button')].filter((b) =>
        /printContract/.test(b.getAttribute('onclick') || '') || /generate contract/i.test(b.textContent || ''),
      )
      btns.forEach((b) => {
        if (b.dataset.ssContractHooked === '1') return
        b.dataset.ssContractHooked = '1'
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); saveContractThenPrint(getProgramWindow()) }, true)
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
            {(client?.name || savedTo) && <span className="qb-bar-client"> · {client?.name || savedTo}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>
                {restoreData
                  ? <>Adjust the build, then <b>Save to Lead</b> to update this quote.</>
                  : client?.id
                    ? <>Build &amp; price, then hit <b>Save to Lead</b> — saves the quote + PDF to this lead.</>
                    : <>Build &amp; price, then hit <b>Save to Lead</b> — attach it to a lead or create a new one.</>}
              </div>}
          <div className="qb-bar-actions">
            <a className="btn-secondary" href={SRC} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in new tab</a>
            <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
            <button type="button" className="btn-primary" style={SAVE_BTN} onClick={saveToLead} disabled={!!status}>{status ? 'Saving…' : restoreData ? '💾 Update Quote' : '💾 Save to Lead'}</button>
          </div>
        </div>
        <iframe ref={iframeRef} src={SRC} title="StormSafe 3D Builder" allow="fullscreen" className="qb-iframe" />
      </div>
      {picker && (
        <SaveToLeadPicker
          getProgramWindow={getProgramWindow}
          getBuildWin={() => iframeRef.current?.contentWindow}
          onClose={() => setPicker(false)}
          onSaved={({ clientName }) => setSavedTo(clientName)}
        />
      )}
    </div>
  )
}
