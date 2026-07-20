// LayoutSheetModal: embeds the StormSafe 2D layout / approval-sheet builder
// (served same-origin at /layout-sheet.html) in a full-screen modal.
//
// The builder is used as-is. IF it exposes the optional window.SS_LAYOUT API
// (seedFromCRM + getSheetHtml), the modal auto-fills the lead's building +
// customer and offers a one-click "Save to lead" that attaches the signed PDF.
// If it doesn't (e.g. the bundled React builder), the modal degrades gracefully:
// the rep builds + signs here, uses the builder's own export to download the
// PDF, then uploads it under "Layout" in the lead's Document Hub.

import { useRef, useState } from 'react'
import { uploadClientDoc } from '../lib/storage'
import { htmlToPdfBlob } from '../lib/quoteCapture'
import { toast } from '../lib/uiFx'

const SRC = '/layout/index.html'

export default function LayoutSheetModal({ client, onClose, onSaved }) {
  const iframeRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [hasApi, setHasApi] = useState(false)

  // Detect the optional integration API and, if present, seed from the lead.
  function detectAndSeed() {
    try {
      const api = iframeRef.current?.contentWindow?.SS_LAYOUT
      if (api && typeof api.seedFromCRM === 'function') {
        setHasApi(true)
        const addr = [client?.address_line, [client?.city, client?.state].filter(Boolean).join(', '), client?.zip].filter(Boolean).join(' ')
        api.seedFromCRM({ size: client?.building_size, customer: client?.name, phone: client?.phone, address: addr || undefined })
      }
    } catch { /* best-effort; no API = manual flow */ }
  }

  function handleLoad() {
    detectAndSeed()
    // Bundled apps mount asynchronously — re-check shortly after load.
    setTimeout(detectAndSeed, 900)
  }

  async function handleSave() {
    if (!client?.id) { toast('Open this from a specific lead to save.'); return }
    setStatus(''); setSaving(true)
    try {
      const api = iframeRef.current?.contentWindow?.SS_LAYOUT
      if (typeof api?.getSheetHtml !== 'function') throw new Error('This builder can’t hand back a PDF — use its own export, then upload under Layout.')
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
      setStatus(''); setSaving(false)
      toast(err.message || 'Could not save the layout sheet.')
    }
  }

  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="2D Layout Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            2D Layout
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.75 }}>
                {hasApi
                  ? 'Place openings & sign, then “Save to lead” to attach the PDF.'
                  : 'Build & sign here, then use the builder’s Export/Save to download the PDF and upload it under Layout in this lead’s Document Hub.'}
              </div>}
          <div className="qb-bar-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Close</button>
            {hasApi && (
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
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
