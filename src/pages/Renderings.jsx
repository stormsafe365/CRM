// Renderings: the global "Renderings" tab — a gallery of every rendering image
// saved across all leads (the per-client "Renderings" document category in
// Storage). Reps drop renderings on a lead's Document Hub; they all show here.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { listClientDocs, getDocSignedUrl } from '../lib/storage'

const isImg = (name) => /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name || '')

export default function Renderings() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: clients, error: e1 } = await supabase
          .from('clients').select('id, name').order('updated_at', { ascending: false })
        if (e1) throw e1
        const lists = await Promise.all((clients ?? []).map(async (c) => {
          const files = await listClientDocs(c.id, 'rendering').catch(() => [])
          return files.map((f) => ({ ...f, clientId: c.id, clientName: c.name }))
        }))
        const flat = lists.flat()
        const withUrls = await Promise.all(flat.map(async (f) => ({
          ...f, url: await getDocSignedUrl(f.path).catch(() => null),
        })))
        if (!cancelled) setItems(withUrls)
      } catch (e) { if (!cancelled) setError(e.message) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Gallery</div>
          <h1>Renderings</h1>
          <div className="sub">{loading ? 'Loading…' : `${items.length} rendering${items.length === 1 ? '' : 's'} across all leads`}</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <section className="tile" style={{ padding: 20 }}>
        {loading ? (
          <div className="muted" style={{ padding: 20 }}>Loading renderings…</div>
        ) : items.length === 0 ? (
          <div className="list-empty">No renderings yet. Upload renderings on a lead’s Document Hub (Renderings category) and they’ll show up here.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {items.map((f) => <RenderCard key={f.path} f={f} />)}
          </div>
        )}
      </section>
    </>
  )
}

function RenderCard({ f }) {
  return (
    <div className="tile" style={{ overflow: 'hidden', cursor: f.url ? 'pointer' : 'default' }}
      onClick={() => f.url && window.open(f.url, '_blank')}>
      <div style={{ aspectRatio: '4 / 3', background: 'var(--inset)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {f.url && isImg(f.name)
          ? <img src={f.url} alt={f.label} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: 'var(--fg-3)', fontSize: 13 }}>{isImg(f.name) ? 'Preview unavailable' : 'PDF / file'}</span>}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ color: 'var(--fg)', fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</div>
        <Link to={`/clients/${f.clientId}`} className="link-cyan" style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>{f.clientName || 'Lead'}</Link>
      </div>
    </div>
  )
}
