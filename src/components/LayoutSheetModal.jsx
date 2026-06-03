// LayoutSheetModal: embeds the StormSafe Building Approval Sheet (the 2D layout
// sign-off tool, served same-origin at /layout-sheet.html) in a full-screen
// modal — same pattern as QuoteBuilderModal. The tool itself is unchanged; the
// CRM copy exposes a small window.SS_LAYOUT API (seed + getSheetHtml) that we
// use to pre-fill the building/customer and, on "Save to lead", rasterize the
// signed sheet to a PDF and attach it to this client's Layout documents.

import { useRef, useState } from 'react'
import { uploadClientDoc } from '../lib/storage'
import { htmlToPdfBlob } from '../lib/quoteCapture'
import { toast } from '../lib/uiFx'

const SRC = '/layout-sheet.html'

export default function LayoutSheetModal({ client, onClose, onSaved }) {
  const iframeRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  // Seed the building dimensions + customer info from the lead once the tool loads.
  function handleLoad() {
    try {
      const api = iframeRef.current?.contentWindow?.SS_LAYOUT
      if (!api?.seedFromCRM) return
      const addr = [client?.address_line, [client?.city, client?.state].filter(Boolean).join(', '), client?.zip].filter(Boolean).join(' ')
      api.seedFromCRM({
        size: client?.building_size,
        customer: client?.name,
        phone: client?.phone,
        address: addr || undefined,
      })
    } catch { /* seeding is best-effort */ }
  }

  async function handleSave() {
    if (!client?.id) { toast('Open this from a specific lead to save.'); return }
    setStatus(''); setSaving(true)
    try {
      const api = iframeRef.current?.contentWindow?.SS_LAYOUT
      if (typeof api?.getSheetHtml !== 'function') throw new Error('The layout tool is still loading — give it a moment.')
      const html = api.getSheetHtml()
      if (!html) throw new Error('Could not read the layout sheet.')

      setStatus('Generating PDF…')
      const blob = await htmlToPdfBlob(html)
      const stamp = new Date().toISOString().slice(0, 10)
      const cust = (api.customerName && api.customerName()) || client?.name || 'lead'
      const slug = cust.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lead'
      const file = new File([blob], `Layout-Approval-${slug}-${stamp}.pdf`, { type: 'application/pdf' })

      setStatus('Saving…')
      await uploadClientDoc(client.id, 'layout', file)
      toast('Layout sheet saved to this lead', 'success')
      onSaved && onSaved()
      onClose()
    } catch (err) {
      setStatus('')
      setSaving(false)
      toast(err.message || 'Could not save the layout sheet.')
    }
  }

  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="2D Layout Sign-Off">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            2D Layout
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.75 }}>
                Place openings &amp; sign, then “Save to lead” to attach the PDF — or use the sheet’s own Print.
              </div>}
          <div className="qb-bar-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Close</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save to lead'}</button>
          </div>
        </div>
        <iframe ref={iframeRef} src={SRC} title="StormSafe Building Approval Sheet" className="qb-iframe" onLoad={handleLoad} />
      </div>
    </div>
  )
}
