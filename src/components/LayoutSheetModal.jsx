// LayoutSheetModal: embeds the StormSafe 2D layout / approval-sheet builder
// (served same-origin at /layout/index.html) in a full-screen modal.
//
// Open Layout reflects a QUOTE (owner 10/6/26): the lead's starred quote, else
// its newest one; the dropdown in the top bar switches to any other quote of the
// lead. The quote's building (size, pitch, wind, truss spacing, gauge, legs,
// colors + wainscot, enclosed / carport / GCH) and EVERY opening at its exact
// spot are read from the quote program itself (quoteLayoutEngine.js) and mapped
// into the builder's coordinates (layoutFromQuote.js), then seeded through the
// builder's window.SS_LAYOUT.seedFromCRM. Lean-tos (with their openings at the
// program's spots), frame lines and the storage partition ride along as
// `geom`: the Approval Sheet draws them on its plan + per-wall elevations
// (layout-src/SheetDoc.jsx); they are also listed as notes under the schedule.
//
// No quotes on the lead → the old behavior (lead's size + customer only).
// "Save to lead" renders the approval sheet to PDF and files it under Layout.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadClientDoc } from '../lib/storage'
import { htmlToPdfBlob } from '../lib/quoteCapture'
import { toast } from '../lib/uiFx'
import { clientAddress, hasBuild, pickLayoutQuote, quoteOptionLabel, rawFromPayload, seedFromQuote, sortStarredFirst } from '../lib/layoutFromQuote'
import { readQuoteForLayout } from '../lib/quoteLayoutEngine'
import { revLabelOf } from '../lib/contractDocs'

const SRC = '/layout/index.html'

export default function LayoutSheetModal({ client, onClose, onSaved }) {
  const iframeRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [hasApi, setHasApi] = useState(false)
  const [quotes, setQuotes] = useState(null) // null = loading; [] = none / unavailable
  const [selId, setSelId] = useState(null)
  const [seedNote, setSeedNote] = useState('')
  const runRef = useRef(0)

  // The lead's quotes (newest first, the starred one on top).
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!client?.id) { setQuotes([]); return }
      const { data, error } = await supabase.from('quotes').select('*').eq('client_id', client.id)
      if (cancelled) return
      const list = error ? [] : sortStarredFirst(data || [])
      setQuotes(list)
      const pick = pickLayoutQuote(list)
      setSelId(pick ? pick.id : null)
    }
    load()
    return () => { cancelled = true }
  }, [client?.id])

  function api() {
    try { return iframeRef.current?.contentWindow?.SS_LAYOUT || null } catch { return null }
  }

  // Detect the builder's integration API (bundled apps mount asynchronously).
  function detect() {
    const a = api()
    if (a && typeof a.seedFromCRM === 'function') { setHasApi(true); return true }
    return false
  }
  function handleLoad() {
    if (detect()) return
    let tries = 0
    const t = setInterval(() => { tries++; if (detect() || tries > 40) clearInterval(t) }, 250)
  }

  // Seed whenever the builder is ready and the chosen quote changes.
  useEffect(() => {
    if (!hasApi || quotes === null) return
    const run = ++runRef.current
    const q = quotes.find((x) => x.id === selId) || null
    const a = api()
    if (!a) return
    const addr = clientAddress(client)

    // No quote on this lead: the lead's own size + customer, as before.
    if (!q) {
      try { a.seedFromCRM({ size: client?.building_size, customer: client?.name, phone: client?.phone, address: addr || undefined, geom: null }) } catch { /* manual flow */ }
      setSeedNote(quotes.length ? '' : 'No quotes on this lead yet — showing the lead’s size; place openings by hand.')
      return
    }
    // A manually typed quote has no saved build to read openings from.
    if (!hasBuild(q)) {
      try {
        a.seedFromCRM({
          size: q.building_size || client?.building_size, customer: client?.name, phone: client?.phone, address: addr || undefined,
          quoteNo: q.quote_number || '', rev: revLabelOf(q), openings: [], notes: [], geom: null,
        })
      } catch { /* ignore */ }
      setSeedNote(`Quote ${q.quote_number ? '#' + q.quote_number : ''} was entered by hand (no saved build) — size only; place the openings by hand.`)
      return
    }

    setStatus(`Reading quote ${q.quote_number ? '#' + q.quote_number : ''}…`)
    setSeedNote('')
    ;(async () => {
      let raw = null
      let warn = ''
      try {
        raw = await readQuoteForLayout(q.payload_json)
      } catch (e) {
        console.warn('Open Layout: could not read the quote program', e)
        raw = rawFromPayload(q.payload_json)
        warn = 'Couldn’t read this quote’s openings — building + colors filled in; place the openings by hand.'
      }
      if (run !== runRef.current) return // the rep switched quotes meanwhile
      const b = api()
      if (!b) return
      let catalogs = null
      try {
        const cc = iframeRef.current.contentWindow.COLOR_CATALOGS
        if (cc) catalogs = { ca: cc.ca?.colors, cci: cc.cci?.colors }
      } catch { /* names fall back to hex */ }
      const seed = seedFromQuote(q, raw, { client, catalogs })
      if (!raw.elev) seed.openings = [] // never leave another build's openings on the sheet
      try { b.seedFromCRM(seed) } catch (e) { console.warn('seedFromCRM failed', e); warn = 'Couldn’t fill the layout from this quote.' }
      setStatus('')
      const n = Array.isArray(seed.openings) ? seed.openings.length : 0
      setSeedNote(warn || `Showing quote ${q.quote_number ? '#' + q.quote_number : ''}${q.starred ? ' ★' : ''} — ${n} opening${n === 1 ? '' : 's'} placed exactly as quoted.`)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasApi, quotes, selId])

  async function handleSave() {
    if (!client?.id) { toast('Open this from a specific lead to save.'); return }
    setStatus(''); setSaving(true)
    try {
      const a = api()
      if (typeof a?.getSheetHtml !== 'function') throw new Error('This builder can’t hand back a PDF — use its own export, then upload under Layout.')
      setStatus('Rendering approval sheet…')
      // Async: the builder switches to Approval Sheet mode and lets it paint first.
      const html = await a.getSheetHtml()
      if (!html) throw new Error('Could not read the layout sheet.')
      setStatus('Generating PDF…')
      const blob = await htmlToPdfBlob(html)
      const stamp = new Date().toISOString().slice(0, 10)
      const cust = (a.customerName && a.customerName()) || client?.name || 'lead'
      const slug = cust.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lead'
      const file = new File([blob], `Layout-Approval-${slug}-${stamp}.pdf`, { type: 'application/pdf' })
      setStatus('Saving…')
      await uploadClientDoc(client.id, 'layout', file)
      toast('Layout sheet saved to this lead', 'success')
      onSaved && onSaved()
      onClose()
    } catch (err) {
      setStatus(''); setSaving(false)
      toast(err.message || 'Could not save the layout sheet.')
    }
  }

  const busyReading = !!status && !saving
  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="2D Layout Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            2D Layout
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {quotes && quotes.length > 0 && (
            <label className="qb-quote-pick" title="Which of this lead’s quotes the layout shows (the starred quote by default)">
              <span className="qb-quote-pick-l">Quote</span>
              <select value={selId || ''} onChange={(e) => setSelId(e.target.value)} disabled={saving || busyReading} aria-label="Quote shown in the layout">
                {quotes.map((q) => <option key={q.id} value={q.id}>{quoteOptionLabel(q)}</option>)}
              </select>
            </label>
          )}
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.8 }}>
                {seedNote || (hasApi
                  ? 'Place openings & sign, then “Save to lead” to attach the PDF.'
                  : 'Build & sign here, then use the builder’s Export/Save to download the PDF and upload it under Layout in this lead’s Document Hub.')}
              </div>}
          <div className="qb-bar-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Close</button>
            {hasApi && (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || busyReading}>
                {saving ? 'Saving…' : 'Save to lead'}
              </button>
            )}
          </div>
        </div>
        <iframe ref={iframeRef} src={SRC} title="StormSafe 2D Layout Builder" className="qb-iframe" onLoad={handleLoad} />
      </div>
    </div>
  )
}
