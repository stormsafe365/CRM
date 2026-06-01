// DocumentHub: per-client file repository with three sections —
// Quotes, Contract, and Renderings. Files live in Supabase Storage
// (private bucket, namespaced by client + category) and are opened via
// short-lived signed URLs. Especially useful once a client is Ordered.

import { useEffect, useRef, useState } from 'react'
import { uploadClientDoc, listClientDocs, getDocSignedUrl, deleteDoc } from '../lib/storage'

const SECTIONS = [
  { key: 'quote',       label: 'Quotes',      accept: 'application/pdf',         hint: 'PDF' },
  { key: 'contract',    label: 'Contracts',   accept: 'application/pdf',         hint: 'PDF' },
  { key: 'rendering',   label: 'Renderings',  accept: 'image/*,application/pdf', hint: 'Image or PDF' },
  { key: 'permit',      label: 'Permits',     accept: 'application/pdf',         hint: 'PDF' },
  { key: 'engineering', label: 'Engineering', accept: 'application/pdf',         hint: 'PDF' },
  { key: 'photo',       label: 'Photos',      accept: 'image/*',                 hint: 'Image' },
]

export default function DocumentHub({ clientId }) {
  return (
    <div className="detail-card detail-card-full" style={{ marginTop: 16 }}>
      <div className="detail-card-title">Document Hub</div>
      <div className="doc-hub">
        {SECTIONS.map(s => <DocSection key={s.key} clientId={clientId} section={s} />)}
      </div>
    </div>
  )
}

function DocSection({ clientId, section }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function refresh() {
    try { setFiles(await listClientDocs(clientId, section.key)); setError('') }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { setLoading(true); refresh() /* eslint-disable-next-line */ }, [clientId, section.key])

  async function onPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try { await uploadClientDoc(clientId, section.key, file); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  async function onView(path) {
    try { window.open(await getDocSignedUrl(path), '_blank') }
    catch (e) { setError(e.message) }
  }

  async function onDelete(path) {
    if (!window.confirm('Delete this file? This cannot be undone.')) return
    try { await deleteDoc(path); await refresh() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="doc-section">
      <div className="doc-section-head">
        <span className="doc-section-title">{section.label}</span>
        <label className="doc-upload-btn">
          {busy ? 'Uploading…' : '+ Upload'}
          <input ref={inputRef} type="file" accept={section.accept} onChange={onPick} disabled={busy} hidden />
        </label>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 8, fontSize: 12 }}>{error}</div>}

      {loading ? (
        <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
      ) : files.length === 0 ? (
        <div className="doc-empty">No {section.label.toLowerCase()} yet · {section.hint}</div>
      ) : (
        <div className="doc-list">
          {files.map(f => (
            <div key={f.path} className="doc-row">
              <button className="doc-name" onClick={() => onView(f.path)} title="Open">{f.label}</button>
              <button className="doc-del" onClick={() => onDelete(f.path)} title="Delete" aria-label="Delete">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
