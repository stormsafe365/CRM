// CustomerDesignsCard: designs this lead sent from their design link (owner
// 10/16/26) — the picture, what they typed, and the full spec (W × L × H, walls,
// every door / window with its position in the program's words, lean-tos,
// colors). Nothing is priced here: the rep builds the quote from it.
// Hidden until the lead has sent a design. Live: a new design appears without
// a refresh.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/uiFx'
import { loadClientDesigns, markDesign, safeImage, designSummary, escHtml } from '../lib/designLinks'

const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }

function when(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Lightbox({ src, onClose }) {
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Design picture" onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1350, background: 'rgba(4,9,16,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
      <img src={src} alt="Customer design" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, boxShadow: '0 18px 60px rgba(0,0,0,.6)' }} />
    </div>,
    document.body,
  )
}

export function DesignItem({ d, onChanged, actions = null }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [big, setBig] = useState(false)
  const img = safeImage(d.image)
  const summary = designSummary(d.design)
  const fileBase = `design-${String(d.name || 'customer').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${String(d.created_at).slice(0, 10)}`

  async function setStatus(status) {
    try {
      await markDesign(supabase, d.id, { status }, user?.id)
      onChanged?.()
    } catch (e) { toast(escHtml(e.message || 'Could not update the design.')) }
  }
  async function copySpec() {
    const text = String(d.spec || '').replace(/[<>]/g, '') // never markup into the program's boxes
    try { await navigator.clipboard.writeText(text); toast('Spec copied', 'success') } catch { window.prompt('Copy the spec:', text) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: img ? '150px minmax(0,1fr)' : 'minmax(0,1fr)', gap: 12, padding: '12px 0', borderTop: '1px solid var(--line, #294059)' }}>
      {img ? (
        <button type="button" onClick={() => setBig(true)} title="Show bigger" style={{ padding: 0, border: '1px solid var(--line, #294059)', borderRadius: 8, overflow: 'hidden', background: '#f3f6f8', cursor: 'zoom-in', alignSelf: 'start' }}>
          <img src={img} alt="Customer design" style={{ display: 'block', width: '100%' }} />
        </button>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {d.status === 'new' ? <span className="status-pill" style={{ background: 'rgba(34,211,200,.15)', color: '#22d3c8' }}>NEW</span> : null}
          <b>{summary || 'Customer design'}</b>
        </div>
        <div style={{ ...MUTED, marginTop: 3 }}>
          {when(d.created_at)} · sent by <span style={{ color: 'var(--fg, #e2e8f0)' }}>{d.name}</span>
          {d.phone ? <> · {d.phone}</> : null}{d.email ? <> · {d.email}</> : null}{d.zip ? <> · ZIP {d.zip}</> : null}
        </div>
        {d.notes ? <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13.5 }}>“{d.notes}”</div> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => setOpen((v) => !v)}>{open ? 'Hide spec' : 'Show the spec'}</button>
          <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={copySpec}>Copy spec</button>
          {img ? <a className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5, textDecoration: 'none' }} href={img} download={`${fileBase}.jpg`}>Save picture</a> : null}
          {actions}
          {!actions && d.status === 'new' ? <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => setStatus('seen')}>Mark reviewed</button> : null}
          {!actions ? <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => setStatus('dismissed')} title="Hide this design from the lead">Remove</button> : null}
        </div>
        {open ? <div style={{ ...MUTED, marginTop: 8 }}>As sent from the customer’s design page (check it against the picture before quoting).</div> : null}
        {open ? (
          <pre style={{ marginTop: 8, padding: 10, background: 'var(--inset, #0B1B32)', border: '1px solid var(--line, #294059)', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.45, maxHeight: 360, overflow: 'auto' }}>{d.spec || '(no spec)'}</pre>
        ) : null}
      </div>
      {big && img ? <Lightbox src={img} onClose={() => setBig(false)} /> : null}
    </div>
  )
}

export default function CustomerDesignsCard({ clientId, onSendLink }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let alive = true
    let run = 0
    async function load() {
      const my = ++run
      const r = await loadClientDesigns(supabase, clientId)
      if (alive && my === run) setRows(r.rows)
    }
    load()
    // many changes close together = one reload
    let t = null
    const soon = () => { clearTimeout(t); t = setTimeout(load, 400) }
    const ch = supabase
      .channel(`designs-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_requests', filter: `client_id=eq.${clientId}` }, soon)
      .subscribe()
    window.addEventListener('ss:designs-updated', soon)
    return () => { alive = false; clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener('ss:designs-updated', soon) }
  }, [clientId])

  if (!rows.length) return null
  const fresh = rows.filter((r) => r.status === 'new').length
  return (
    <section className="card card-pad" aria-label="Customer designs">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h3>Customer Designs{fresh ? ` · ${fresh} new` : ''}</h3>
        {onSendLink ? <span className="link-cyan" role="button" onClick={onSendLink}>Send another link</span> : null}
      </div>
      <div style={{ ...MUTED, marginBottom: 4 }}>Sent by the customer from their design link. No prices: build the quote from the spec.</div>
      {rows.map((d) => <DesignItem key={d.id} d={d} onChanged={() => window.dispatchEvent(new CustomEvent('ss:designs-updated'))} />)}
    </section>
  )
}
