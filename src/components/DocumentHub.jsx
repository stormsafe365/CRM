// DocumentHub: per-client file repository. Files live in Supabase Storage
// (private bucket, namespaced by client + category) and open via short-lived
// signed URLs. Styled to the design's Document Hub — 6 category cards that
// filter a combined file table; upload targets the active category.

import { useEffect, useRef, useState } from 'react'
import { uploadClientDoc, listClientDocs, getDocSignedUrl, deleteDoc } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { openMenu, MENU_ICON } from '../lib/uiFx'
import LayoutSheetModal from './LayoutSheetModal'

const SECTIONS = [
  { key: 'quote',       label: 'Quotes',      accept: 'application/pdf',         hint: 'PDF' },
  { key: 'contract',    label: 'Contracts',   accept: 'application/pdf',         hint: 'PDF' },
  { key: 'rendering',   label: 'Renderings',  accept: 'image/*,application/pdf', hint: 'Image or PDF' },
  { key: 'layout',      label: 'Layout',      accept: 'application/pdf,image/*', hint: 'Signed sheet' },
  { key: 'revisions',   label: 'Revisions',   accept: 'application/pdf,image/*', hint: 'PDF or image' },
  { key: 'additional',  label: 'Additional',  accept: '',                        hint: 'Any file' },
]

const ic = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
const ICONS = {
  all:         ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
  quote:       ic(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  contract:    ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>),
  rendering:   ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></>),
  layout:      ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>),
  revisions:   ic(<><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" /></>),
  additional:  ic(<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" /><path d="M12 11v5M9.5 13.5h5" /></>),
}
const EYE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
const TRASH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>

const labelSingular = (key) => SECTIONS.find(s => s.key === key)?.label.replace(/s$/, '') || key
const fmtDate = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}

export default function DocumentHub({ clientId, clientName, client, onBuildQuote }) {
  const { user } = useAuth()
  const [filesByCat, setFilesByCat] = useState({})
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [layoutOpen, setLayoutOpen] = useState(false)
  const inputRef = useRef(null)
  const uploadCat = useRef('quote')

  async function refresh() {
    try {
      const entries = await Promise.all(SECTIONS.map(async s => [s.key, await listClientDocs(clientId, s.key)]))
      setFilesByCat(Object.fromEntries(entries))
      setError('')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { setLoading(true); refresh() /* eslint-disable-next-line */ }, [clientId])

  // Storage has no realtime — refresh when a quote/contract PDF is saved to this
  // lead from the builder (BuildQuoteModal dispatches ss:docs-updated).
  useEffect(() => {
    const onDocs = (e) => { if (!e.detail || e.detail.clientId === clientId) refresh() }
    window.addEventListener('ss:docs-updated', onDocs)
    return () => window.removeEventListener('ss:docs-updated', onDocs)
    /* eslint-disable-next-line */
  }, [clientId])

  const counts = Object.fromEntries(SECTIONS.map(s => [s.key, (filesByCat[s.key] || []).length]))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const rows = (active === 'all'
    ? SECTIONS.flatMap(s => (filesByCat[s.key] || []).map(f => ({ ...f, cat: s.key })))
    : (filesByCat[active] || []).map(f => ({ ...f, cat: active })))

  function triggerUpload(cat) {
    uploadCat.current = cat
    const sec = SECTIONS.find(s => s.key === cat)
    if (inputRef.current) { inputRef.current.accept = sec?.accept || ''; inputRef.current.click() }
  }
  async function onPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try {
      const cat = uploadCat.current
      const path = await uploadClientDoc(clientId, cat, file)
      // Uploading a quote PDF should also appear in the Quotes box — create a
      // quote record that points at the uploaded file. Size is parsed from the
      // filename (e.g. "…24x30x14.pdf") when present.
      if (cat === 'quote') {
        const m = file.name.match(/(\d+)\s*[xX]\s*(\d+)(?:\s*[xX]\s*(\d+))?/)
        const size = m ? [m[1], m[2], m[3]].filter(Boolean).join('x') : null
        await supabase.from('quotes').insert({
          client_id: clientId,
          quote_date: new Date().toISOString().slice(0, 10),
          building_size: size,
          status: 'draft',
          pdf_snapshot_url: path,
          notes: file.name.replace(/\.[^.]+$/, ''),
          created_by: user?.id ?? null,
        })
      }
      await refresh()
    }
    catch (err) { setError(err.message) }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }
  async function onView(path) {
    try { window.open(await getDocSignedUrl(path), '_blank') } catch (e) { setError(e.message) }
  }
  async function onDelete(path) {
    if (!window.confirm('Delete this file? This cannot be undone.')) return
    try {
      await deleteDoc(path)
      // Mirror: if a quote is backed by this exact PDF, soft-delete that quote too
      // so the Quotes box updates in lockstep (its realtime picks up the change).
      // No-op for non-quote files (contracts/renderings) — no row points at them.
      try {
        await supabase.from('quotes')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
          .eq('client_id', clientId).eq('pdf_snapshot_url', path)
      } catch { /* the file is deleted regardless */ }
      await refresh()
    } catch (e) { setError(e.message) }
  }

  // Category card → popover menu (View all / Upload / [Build new quote]).
  function openCatMenu(e, key) {
    const sec = SECTIONS.find(s => s.key === key)
    const items = [
      { id: 'view', label: `View all ${sec.label.toLowerCase()}`, icon: MENU_ICON.eye, onClick: () => setActive(key) },
      { id: 'upload', label: `Upload ${labelSingular(key).toLowerCase()}`, icon: MENU_ICON.upload, onClick: () => triggerUpload(key) },
    ]
    if (key === 'quote' && onBuildQuote) items.push({ id: 'build', label: 'Build new quote', icon: MENU_ICON.pencil, onClick: onBuildQuote })
    openMenu(e.currentTarget, `${sec.label} · ${counts[key]} files`, items)
  }

  return (
    <section className="card card-pad">
      <div className="section-head">
        <h3>Document Hub</h3>
        <div className="right" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span className="link-cyan" role="button" onClick={() => setLayoutOpen(true)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 4 }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
            Open Layout
          </span>
          <span className="link-cyan" role="button" onClick={() => triggerUpload(active === 'all' ? 'quote' : active)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -2, marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></svg>
            {busy ? 'Uploading…' : 'Upload'}
          </span>
        </div>
      </div>
      <input ref={inputRef} type="file" onChange={onPick} hidden />

      <div className="doc-cats">
        <div className="doc-cat" onClick={() => setActive('all')} style={active === 'all' ? ACTIVE_CAT : undefined}>
          <div className="ic">{ICONS.all}</div><div className="nm">All Files</div><div className="ct">{total} Files</div>
        </div>
        {SECTIONS.map(s => (
          <div key={s.key} className="doc-cat" data-menu-anchor onClick={(e) => openCatMenu(e, s.key)}
            title="Open menu" style={active === s.key ? ACTIVE_CAT : undefined}>
            <div className="ic">{ICONS[s.key]}</div><div className="nm">{s.label}</div><div className="ct">{counts[s.key]} Files</div>
          </div>
        ))}
      </div>

      {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}

      {loading ? (
        <div className="muted" style={{ padding: '16px 0' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="list-empty">No files in {active === 'all' ? 'this lead' : labelSingular(active).toLowerCase()} yet — click a category and Upload to add one.</div>
      ) : (
        <table className="doc-table">
          <thead><tr><th>File Name</th><th>Category</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map(f => (
              <tr key={f.path}>
                <td><span className="doc-file" role="button" onClick={() => onView(f.path)} style={{ cursor: 'pointer' }}>{ICONS[f.cat]}{f.label}</span></td>
                <td><span className={`cat-tag${f.cat === 'rendering' ? ' rendering' : ''}`}>{labelSingular(f.cat)}</span></td>
                <td className="doc-date num">{fmtDate(f.createdAt)}</td>
                <td>
                  <div className="doc-actions">
                    <span role="button" title="View" onClick={() => onView(f.path)}>{EYE}</span>
                    <span role="button" title="Delete" onClick={() => onDelete(f.path)}>{TRASH}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {layoutOpen && <LayoutSheetModal client={client || { id: clientId, name: clientName }} onSaved={refresh} onClose={() => setLayoutOpen(false)} />}
    </section>
  )
}

const ACTIVE_CAT = { borderColor: 'rgba(9,214,220,0.5)', boxShadow: '0 0 0 1px rgba(9,214,220,0.25)' }
