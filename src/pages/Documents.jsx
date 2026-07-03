// Documents: a company-wide Document Hub across EVERY client in the CRM.
// Ported from the standalone Doc Hub design onto the app's current theme
// (cyan/Orbitron), keeping the per-category accent hues used by the per-client
// hub. Files live in Supabase Storage; this page walks them across all clients,
// joins client names, and offers category filtering, search, and a preview.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { listAllDocs, getDocSignedUrl } from '../lib/storage'

const ic = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
const ICONS = {
  all:        ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
  quote:      ic(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  contract:   ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>),
  rendering:  ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></>),
  layout:     ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>),
  revisions:  ic(<><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" /></>),
  additional: ic(<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" /><path d="M12 11v5M9.5 13.5h5" /></>),
  doc:        ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
  img:        ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></>),
  cad:        ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>),
}
const SearchIc = ic(<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>)
const EyeIc = ic(<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>)
const DownloadIc = ic(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>)
const ExternalIc = ic(<><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>)
const ChevronIc = ic(<path d="M6 9l6 6 6-6" />)

const CAT_ORDER = ['quote', 'contract', 'rendering', 'layout', 'revisions', 'additional']
const CAT_LABEL = { all: 'All Files', quote: 'Quotes', contract: 'Contracts', rendering: 'Renderings', layout: 'Layout', revisions: 'Revisions', additional: 'Additional' }
const CHIP_LABEL = { quote: 'Quote', contract: 'Contract', rendering: 'Render', layout: 'Layout', revisions: 'Revision', additional: 'Extra' }
// Same accents as the per-client Doc Hub (6A) for consistency.
const CAT_ACCENT = { all: '#14A6A0', quote: '#1cddd5', contract: '#4d9d78', rendering: '#ff8f49', layout: '#99acff', revisions: '#1cddd5', additional: '#4d9d78' }
const STAT_DOT = { docs: '#14A6A0', clients: '#99acff', quotes: '#1cddd5', month: '#4d9d78' }
const COLLAPSE = 8

const hexRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
const accentVars = (accent) => ({
  '--accent': accent, '--ring': hexRgba(accent, 0.42), '--soft': hexRgba(accent, 0.20),
  '--tile': hexRgba(accent, 0.14), '--tileBd': hexRgba(accent, 0.32),
  '--chipBg': hexRgba(accent, 0.12), '--chipBd': hexRgba(accent, 0.38),
})

const fmtDate = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}
const fmtSize = (b) => {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${Math.round(b / 1024)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}
const fileExt = (label) => (label.includes('.') ? label.split('.').pop().toLowerCase() : '')
const fileType = (label) => {
  const e = fileExt(label)
  if (e === 'pdf') return 'doc'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(e)) return 'img'
  if (['dwg', 'dxf'].includes(e)) return 'cad'
  return 'doc'
}

export default function Documents() {
  const [docs, setDocs] = useState([])
  const [names, setNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState('all')
  const [search, setSearch] = useState('')
  const [exp, setExp] = useState(false)
  const [preview, setPreview] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [all, clientsRes] = await Promise.all([
        listAllDocs(),
        supabase.from('clients').select('id, name'),
      ])
      const nameMap = Object.fromEntries((clientsRes.data ?? []).map(c => [c.id, c.name]))
      setNames(nameMap)
      const sorted = all
        .map(d => ({ ...d, client: nameMap[d.clientId] || 'Unknown client', ts: d.createdAt ? Date.parse(d.createdAt) : 0 }))
        .sort((a, b) => b.ts - a.ts)
      setDocs(sorted)
      setError('')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])
  // Storage has no realtime; refresh when a quote/contract is saved elsewhere.
  useEffect(() => {
    const onDocs = () => load()
    window.addEventListener('ss:docs-updated', onDocs)
    return () => window.removeEventListener('ss:docs-updated', onDocs)
    /* eslint-disable-next-line */
  }, [])
  // Reset the collapse whenever the filter changes.
  useEffect(() => { setExp(false) }, [active, search])

  const counts = useMemo(() => {
    const c = { all: docs.length }
    CAT_ORDER.forEach(k => { c[k] = 0 })
    docs.forEach(d => { c[d.cat] = (c[d.cat] || 0) + 1 })
    return c
  }, [docs])

  const stats = useMemo(() => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${now.getMonth()}`
    const distinct = new Set(docs.map(d => d.clientId)).size
    const month = docs.filter(d => {
      if (!d.ts) return false
      const dt = new Date(d.ts)
      return `${dt.getFullYear()}-${dt.getMonth()}` === ym
    }).length
    return { docs: docs.length, clients: distinct, quotes: counts.quote || 0, month }
  }, [docs, counts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter(d => {
      if (active !== 'all' && d.cat !== active) return false
      if (!q) return true
      return d.label.toLowerCase().includes(q)
        || (CHIP_LABEL[d.cat] || '').toLowerCase().includes(q)
        || (CAT_LABEL[d.cat] || '').toLowerCase().includes(q)
        || d.client.toLowerCase().includes(q)
    })
  }, [docs, active, search])

  const visible = exp ? filtered : filtered.slice(0, COLLAPSE)

  async function openDoc(d) {
    try { window.open(await getDocSignedUrl(d.path), '_blank') } catch (e) { setError(e.message) }
  }

  return (
    <div className="dhx">
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">All Clients</div>
          <h1>Document Hub</h1>
          <div className="sub">Every quote, contract, rendering and file across your book of business — searchable in one place. Pick a category to filter, or search by client.</div>
        </div>
        <div className="dhx-search">
          {SearchIc}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files, categories or clients" />
          {search && <button className="dhx-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>}
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Stats strip */}
      <div className="dhx-stats">
        {[
          ['docs', stats.docs, 'Documents'],
          ['clients', stats.clients, 'Clients'],
          ['quotes', stats.quotes, 'Quotes'],
          ['month', stats.month, 'Uploaded This Month'],
        ].map(([k, val, label]) => (
          <div className="dhx-stat" key={k}>
            <div className="dhx-stat-top"><span className="num">{val}</span><span className="dhx-dot" style={{ background: STAT_DOT[k], boxShadow: `0 0 7px ${STAT_DOT[k]}` }} /></div>
            <div className="dhx-stat-lab">{label}</div>
          </div>
        ))}
      </div>

      {/* Category tiles */}
      <div className="dhx-cats">
        {['all', ...CAT_ORDER].map(key => (
          <button key={key} className={`dhx-cat${active === key ? ' on' : ''}`} style={accentVars(CAT_ACCENT[key])} onClick={() => setActive(key)}>
            <span className="dhx-cat-tile">{ICONS[key]}</span>
            <span className="dhx-cat-nm">{CAT_LABEL[key]}</span>
            <span className="dhx-cat-ct num">{counts[key] || 0} files</span>
          </button>
        ))}
      </div>

      {/* Table panel */}
      <div className="dhx-panel">
        <div className="dhx-panel-head">
          <span className="dhx-panel-title">{CAT_LABEL[active]}</span>
          <span className="dhx-panel-count num">{filtered.length} {filtered.length === 1 ? 'document' : 'documents'}</span>
          <span className="dhx-spacer" />
          <span className="dhx-newest">Newest first</span>
        </div>

        <div className="dhx-colhead">
          <span>Document</span><span>Category</span><span>Uploaded</span><span className="r">Size</span><span className="r">Open</span>
        </div>

        {loading ? (
          <div className="dhx-loading">Loading documents…</div>
        ) : visible.length === 0 ? (
          <div className="dhx-empty">
            <div className="dhx-empty-1">No documents match your search.</div>
            <div className="dhx-empty-2">Try another category, or clear the search box.</div>
          </div>
        ) : (
          <div className="dhx-rows" key={`${active}-${search}-${exp}`}>
            {visible.map(d => {
              const acc = CAT_ACCENT[d.cat] || CAT_ACCENT.all
              return (
                <div key={d.path} className="dhx-row" style={accentVars(acc)} onClick={() => setPreview(d)}>
                  <div className="dhx-doc">
                    <span className="dhx-doc-ic">{ICONS[fileType(d.label) === 'img' ? 'img' : fileType(d.label) === 'cad' ? 'cad' : 'doc']}</span>
                    <div className="dhx-doc-txt">
                      <div className="dhx-doc-nm">{d.label}</div>
                      <div className="dhx-doc-cl"><span className="dhx-cl-dot" />{d.client}</div>
                    </div>
                  </div>
                  <div><span className="dhx-chip">{CHIP_LABEL[d.cat] || d.cat}</span></div>
                  <div className="dhx-up num">{fmtDate(d.createdAt)}</div>
                  <div className="dhx-sz num r">{fmtSize(d.size)}</div>
                  <div className="r"><button className="dhx-open" title="Open" onClick={(e) => { e.stopPropagation(); openDoc(d) }}>{EyeIc}</button></div>
                </div>
              )
            })}

            {filtered.length > COLLAPSE && (
              <button className="dhx-showall" onClick={() => setExp(v => !v)}>
                {exp ? 'Show less' : `Show all ${filtered.length}`}
                <span className={`dhx-chev${exp ? ' flip' : ''}`}>{ChevronIc}</span>
              </button>
            )}
          </div>
        )}

        <div className="dhx-foot">
          <span className="num">Showing {Math.min(visible.length, filtered.length)} of {filtered.length}</span>
          <span className="num">{stats.clients} {stats.clients === 1 ? 'client' : 'clients'} on file</span>
        </div>
      </div>

      {preview && <DocPreview doc={preview} onClose={() => setPreview(null)} onOpen={openDoc} />}
    </div>
  )
}

function DocPreview({ doc, onClose, onOpen }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')
  const acc = CAT_ACCENT[doc.cat] || CAT_ACCENT.all
  const type = fileType(doc.label)
  const ext = (fileExt(doc.label) || '').toUpperCase() || '—'

  useEffect(() => {
    let cancel = false
    getDocSignedUrl(doc.path).then(u => { if (!cancel) setUrl(u) }).catch(e => { if (!cancel) setErr(e.message) })
    return () => { cancel = true }
  }, [doc.path])

  async function download() {
    const u = url || await getDocSignedUrl(doc.path)
    const a = document.createElement('a')
    a.href = u; a.download = doc.label; a.rel = 'noopener'; a.target = '_blank'
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <div className="dhx-scrim" onClick={onClose}>
      <div className="dhx-modal" style={accentVars(acc)} onClick={e => e.stopPropagation()}>
        <div className="dhx-modal-head">
          <span className="dhx-modal-ic">{ICONS[type === 'img' ? 'img' : type === 'cad' ? 'cad' : 'doc']}</span>
          <div className="dhx-modal-txt">
            <div className="dhx-modal-nm">{doc.label}</div>
            <div className="dhx-modal-cl">{doc.client}</div>
          </div>
          <button className="dhx-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dhx-modal-body">
          <div className="dhx-meta">
            <div className="dhx-meta-c"><div className="dhx-meta-l">Client</div><div className="dhx-meta-v">{doc.client}</div></div>
            <div className="dhx-meta-c"><div className="dhx-meta-l">Category</div><div className="dhx-meta-v" style={{ color: acc }}>{CAT_LABEL[doc.cat]}</div></div>
            <div className="dhx-meta-c"><div className="dhx-meta-l">Uploaded</div><div className="dhx-meta-v num">{fmtDate(doc.createdAt)}</div></div>
            <div className="dhx-meta-c"><div className="dhx-meta-l">File Size</div><div className="dhx-meta-v num">{fmtSize(doc.size)} · {ext}</div></div>
          </div>

          <div className="dhx-view" style={{ '--accent': acc }}>
            {err ? (
              <div className="dhx-view-msg">Couldn’t load a preview. Use “Open Full” to view the file.</div>
            ) : !url ? (
              <div className="dhx-view-msg">Loading preview…</div>
            ) : type === 'img' ? (
              <img src={url} alt={doc.label} />
            ) : type === 'doc' && ext === 'PDF' ? (
              <iframe title={doc.label} src={url} />
            ) : (
              <div className="dhx-view-msg">No inline preview for {ext} files. Use “Open Full” to view.</div>
            )}
          </div>
        </div>

        <div className="dhx-modal-foot">
          <button className="dhx-btn-ghost" onClick={download}>{DownloadIc}Download</button>
          <button className="dhx-btn-primary" onClick={() => onOpen(doc)}>{ExternalIc}Open Full</button>
        </div>
      </div>
    </div>
  )
}
