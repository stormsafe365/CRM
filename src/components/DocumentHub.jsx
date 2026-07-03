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

// 6A category accents (rotating palette; All Files uses the brand teal) + short chip labels.
const CAT_ACCENT = { all: '#14A6A0', quote: '#1cddd5', contract: '#4d9d78', rendering: '#ff8f49', layout: '#99acff', revisions: '#1cddd5', additional: '#4d9d78' }
const CHIP_LABEL = { quote: 'Quote', contract: 'Contract', rendering: 'Render', layout: 'Layout', revisions: 'Revision', additional: 'Extra' }
const hexRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
const accentVars = (accent) => ({
  '--accent': accent, '--ring': hexRgba(accent, 0.40), '--soft': hexRgba(accent, 0.20),
  '--tile': hexRgba(accent, 0.14), '--tileBd': hexRgba(accent, 0.32),
  '--chipBg': hexRgba(accent, 0.12), '--chipBd': hexRgba(accent, 0.38),
})

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
  const [docExpanded, setDocExpanded] = useState(false)
  const selectCat = (key) => { setActive(key); setDocExpanded(false) }

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

  const activeAccent = CAT_ACCENT[active] || '#14A6A0'
  const visibleRows = docExpanded ? rows : rows.slice(0, 4)

  return (
    <section className="doc-hub" style={accentVars(activeAccent)}>
      {/* Header bar */}
      <div className="doc-hub-head">
        <span className="doc-hub-mark" />
        <span className="doc-hub-title">Document Hub</span>
        <button className="doc-hub-ghost" onClick={() => setLayoutOpen(true)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
          Open Layout
        </button>
        <button className="doc-hub-cta" onClick={() => triggerUpload(active === 'all' ? 'quote' : active)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></svg>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      <input ref={inputRef} type="file" onChange={onPick} hidden />

      {/* Category grid — 6A centered cards with a per-category accent bar */}
      <div className="doc-cats-6a">
        <button className={`cat-card${active === 'all' ? ' on' : ''}`} style={accentVars(CAT_ACCENT.all)} onClick={() => selectCat('all')}>
          <span className="cat-bar" /><span className="cat-tile">{ICONS.all}</span>
          <span className="cat-nm">All Files</span><span className="cat-ct num">{total} files</span>
        </button>
        {SECTIONS.map(s => (
          <button key={s.key} className={`cat-card${active === s.key ? ' on' : ''}`} style={accentVars(CAT_ACCENT[s.key])} onClick={() => selectCat(s.key)}>
            <span className="cat-bar" /><span className="cat-tile">{ICONS[s.key]}</span>
            <span className="cat-nm">{s.label}</span><span className="cat-ct num">{counts[s.key]} files</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner" style={{ margin: '0 24px 12px' }}>{error}</div>}

      {/* File list */}
      {loading ? (
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="doc-empty">No files in {active === 'all' ? 'this lead' : labelSingular(active).toLowerCase()} yet.</div>
      ) : (
        <div className="doc-list" key={`${active}-${docExpanded}`}>
          <div className="doc-list-head"><span>File Name</span><span>Category</span><span>Date</span><span className="r">Actions</span></div>
          {visibleRows.map(f => {
            const acc = CAT_ACCENT[f.cat] || '#14A6A0'
            return (
              <div key={f.path} className="doc-row" style={accentVars(acc)}>
                <span className="doc-name" role="button" onClick={() => onView(f.path)}><span className="doc-name-ic">{ICONS[f.cat]}</span>{f.label}</span>
                <span><span className="doc-chip">{CHIP_LABEL[f.cat] || labelSingular(f.cat)}</span></span>
                <span className="doc-date num">{fmtDate(f.createdAt)}</span>
                <span className="doc-acts">
                  <button title="View" onClick={() => onView(f.path)}>{EYE}</button>
                  <button title="Delete" className="del" onClick={() => onDelete(f.path)}>{TRASH}</button>
                </span>
              </div>
            )
          })}
          {rows.length > 4 && (
            <button className="doc-showall" onClick={() => setDocExpanded(v => !v)}>
              {docExpanded ? 'Show less' : `Show all ${rows.length}`}
              <svg className={docExpanded ? 'flip' : ''} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="doc-hub-foot">
        <span className="num">{total} {total === 1 ? 'file' : 'files'}</span>
        <span className="num">Updated {fmtDate(new Date().toISOString())}</span>
      </div>

      {layoutOpen && <LayoutSheetModal client={client || { id: clientId, name: clientName }} onSaved={refresh} onClose={() => setLayoutOpen(false)} />}
    </section>
  )
}

const ACTIVE_CAT = { borderColor: 'rgba(9,214,220,0.5)', boxShadow: '0 0 0 1px rgba(9,214,220,0.25)' }
