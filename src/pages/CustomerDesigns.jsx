// CustomerDesigns: every design customers send from their design links, in one
// place (owner 10/16/26: "some of these people wont be added in to our leads
// just yet ... On the left side panel add a customer request or something like
// that ... it's just gotta all land somewhere").
//   New            - not reviewed yet (on a lead or not)
//   Not on a lead  - waiting to be attached to a lead or made into one
//   All / Removed
// "New design link" sends a link to anyone - pick a lead, or "No lead yet".
// Live: a design that comes in shows up without a refresh.

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DESIGN_VIEWS, loadDesigns, loadLeadNames, MISSING_TABLE_TEXT, loadSharedLinks, setSharedLinkOff, SHARED_MISSING_TEXT, escHtml } from '../lib/designLinks'
import { toast } from '../lib/uiFx'
import { useDesignCounts } from '../lib/useDesignCounts'
import { DesignInboxRow } from '../components/DesignInbox'
import DesignLinkModal from '../components/DesignLinkModal'

const PAGE = 30
// realtime-js returns the SAME channel for the same name: every effect run gets its own
let chanSeq = 0
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }
const when = (iso) => { try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '—' } }

/** Shared links (contractors / Facebook): name, when made, how many designs, Copy link, Turn off / on. */
function SharedLinks({ onNew, reloadKey }) {
  const [state, setState] = useState({ links: null, missing: false })
  const load = async () => setState(await loadSharedLinks(supabase))
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [reloadKey])
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast('Link copied', 'success') } catch { window.prompt('Copy the link:', url) }
  }
  async function toggle(l) {
    const off = !l.revoked_at
    if (off && !window.confirm(`Turn off the shared link "${l.label}"? Anyone who opens it after this sees that the link is not active.`)) return
    try { await setSharedLinkOff(supabase, l.token, off); load() } catch (e) { toast(escHtml(e.message || 'Could not change the link.')) }
  }
  const { links, missing } = state
  return (
    <section className="tile" style={{ padding: '14px 18px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={MUTED}>One link for many people: give it to a concrete contractor, or post it on Facebook / Messenger. Every design from it lands here, marked with the link's name.</div>
        <button type="button" className="btn-primary" onClick={onNew}>New shared link</button>
      </div>
      {missing ? <div className="list-empty">{SHARED_MISSING_TEXT}</div>
        : links === null ? <div className="muted" style={{ padding: 16 }}>Loading…</div>
        : links.length === 0 ? <div className="list-empty">No shared links yet.</div>
        : (
          <table className="dt" style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Made</th><th>Designs</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {links.map((l) => {
                const expired = new Date(l.expires_at) < new Date()
                return (
                  <tr key={l.token}>
                    <td><b>{l.label}</b></td>
                    <td className="num">{when(l.created_at)}</td>
                    <td className="num">{l.designs}</td>
                    <td>{l.revoked_at ? 'Off' : expired ? 'Expired' : `On until ${when(l.expires_at)}`}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5, marginRight: 6 }} onClick={() => copy(l.url)} disabled={!!l.revoked_at || expired}>Copy link</button>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => toggle(l)}>{l.revoked_at ? 'Turn on' : 'Turn off'}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </section>
  )
}

export default function CustomerDesigns() {
  const [params, setParams] = useSearchParams()
  const view = DESIGN_VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'new'
  const [rows, setRows] = useState(null) // null = loading
  const [names, setNames] = useState(new Map())
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false) // false | 'any' | 'shared'
  const [sharedReload, setSharedReload] = useState(0)
  const { fresh, waiting } = useDesignCounts()
  const runRef = useRef(0)

  useEffect(() => { setLimit(PAGE); setRows(null) }, [view])

  useEffect(() => {
    if (view === 'shared') return undefined // the Shared links tab loads its own list
    let alive = true
    async function load() {
      const my = ++runRef.current
      const r = await loadDesigns(supabase, view, limit)
      if (!alive || my !== runRef.current) return
      setMissing(!!r.missing)
      if (r.error && !r.missing) {
        // a failed reload keeps what is on screen; the banner says it did not refresh
        setError(`Could not load the designs: ${r.error.message || 'try again'}.`)
        setRows((prev) => prev ?? [])
        return
      }
      setError('')
      setRows(r.rows)
      const n = await loadLeadNames(supabase, r.rows.map((d) => d.client_id))
      if (alive && my === runRef.current) setNames(n)
    }
    load()
    // a burst of changes = one reload
    let t = null
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500) }
    const ch = supabase.channel(`designs-page-${view}-${++chanSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_requests' }, soon)
      .subscribe()
    window.addEventListener('ss:designs-updated', soon)
    return () => { alive = false; clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener('ss:designs-updated', soon) }
  }, [view, limit])

  const done = () => window.dispatchEvent(new CustomEvent('ss:designs-updated'))
  const countFor = (k) => (k === 'new' ? fresh : k === 'waiting' ? waiting : null) // null = no count shown
  const emptyText = {
    new: 'No new designs. When a customer taps "Send to my steel building rep", it shows up here.',
    waiting: 'Every design is on a lead.',
    all: 'No designs yet. Send someone a design link to get started.',
    removed: 'Nothing removed.',
  }[view]

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">From design links</div>
          <h1>Customer Designs</h1>
          <div className="sub">
            {fresh} new · {waiting} not on a lead yet. Customers design their building on their link (no prices) and send it to you here.
          </div>
        </div>
        <div className="right">
          <button type="button" className="btn btn-primary" onClick={() => setLinkOpen('any')} title="Send someone a design link: pick a lead, one person who is not a lead yet, or a shared link for a contractor / Facebook">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New design link
          </button>
        </div>
      </div>

      <div className="list-tabs" style={{ marginBottom: 12 }}>
        {DESIGN_VIEWS.map((v) => (
          <button key={v.key} type="button" className={`list-tab${view === v.key ? ' on' : ''}`} onClick={() => setParams(v.key === 'new' ? {} : { view: v.key })}
            style={view === v.key ? { background: 'rgba(34,211,200,.12)', borderColor: 'rgba(34,211,200,.45)' } : undefined}>
            {v.label}
            {countFor(v.key) !== null ? <span className="list-tab-count">{countFor(v.key)}</span> : null}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {view === 'shared' ? <SharedLinks reloadKey={sharedReload} onNew={() => setLinkOpen('shared')} /> : (
      <section className="tile" style={{ padding: '4px 18px 16px' }}>
        {missing ? (
          <div className="list-empty">{MISSING_TABLE_TEXT}</div>
        ) : rows === null ? (
          <div className="muted" style={{ padding: 20 }}>Loading…</div>
        ) : rows.length === 0 ? (
          error ? null : <div className="list-empty">{emptyText}</div>
        ) : (
          <>
            {rows.map((d) => <DesignInboxRow key={d.id} d={d} lead={names.get(d.client_id)} onDone={done} />)}
            {rows.length >= limit ? (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>Show more</button>
              </div>
            ) : null}
          </>
        )}
      </section>
      )}

      {linkOpen ? <DesignLinkModal shared={linkOpen === 'shared'} onMade={() => setSharedReload((n) => n + 1)} onClose={() => setLinkOpen(false)} /> : null}
    </>
  )
}
