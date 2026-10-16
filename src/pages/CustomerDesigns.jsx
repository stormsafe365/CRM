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
import { DESIGN_VIEWS, loadDesigns, loadLeadNames, MISSING_TABLE_TEXT } from '../lib/designLinks'
import { useDesignCounts } from '../lib/useDesignCounts'
import { DesignInboxRow } from '../components/DesignInbox'
import DesignLinkModal from '../components/DesignLinkModal'

const PAGE = 30

export default function CustomerDesigns() {
  const [params, setParams] = useSearchParams()
  const view = DESIGN_VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'new'
  const [rows, setRows] = useState(null) // null = loading
  const [names, setNames] = useState(new Map())
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const { fresh, waiting } = useDesignCounts()
  const runRef = useRef(0)

  useEffect(() => { setLimit(PAGE); setRows(null) }, [view])

  useEffect(() => {
    let alive = true
    async function load() {
      const my = ++runRef.current
      const r = await loadDesigns(supabase, view, limit)
      if (!alive || my !== runRef.current) return
      setMissing(!!r.missing)
      setError(r.error && !r.missing ? (r.error.message || 'Could not load the designs.') : '')
      setRows(r.rows)
      const n = await loadLeadNames(supabase, r.rows.map((d) => d.client_id))
      if (alive && my === runRef.current) setNames(n)
    }
    load()
    // a burst of changes = one reload
    let t = null
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500) }
    const ch = supabase.channel(`designs-page-${view}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_requests' }, soon)
      .subscribe()
    window.addEventListener('ss:designs-updated', soon)
    return () => { alive = false; clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener('ss:designs-updated', soon) }
  }, [view, limit])

  const done = () => window.dispatchEvent(new CustomEvent('ss:designs-updated'))
  const countFor = (k) => (k === 'new' ? fresh : k === 'waiting' ? waiting : null)
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
          <button type="button" className="btn btn-primary" onClick={() => setLinkOpen(true)} title="Send someone a design link: pick a lead, or send it before they are a lead">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New design link
          </button>
        </div>
      </div>

      <div className="list-tabs" style={{ marginBottom: 12 }}>
        {DESIGN_VIEWS.map((v) => (
          <button key={v.key} type="button" className={`list-tab${view === v.key ? ' on' : ''}`} onClick={() => setParams(v.key === 'new' ? {} : { view: v.key })}>
            {v.label}
            {countFor(v.key) !== null ? <span className="list-tab-count">{countFor(v.key)}</span> : null}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="tile" style={{ padding: '4px 18px 16px' }}>
        {missing ? (
          <div className="list-empty">{MISSING_TABLE_TEXT}</div>
        ) : rows === null ? (
          <div className="muted" style={{ padding: 20 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="list-empty">{emptyText}</div>
        ) : (
          <>
            {rows.map((d) => <DesignInboxRow key={d.id} d={d} leadName={names.get(d.client_id)} onDone={done} />)}
            {rows.length >= limit ? (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>Show more</button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {linkOpen ? <DesignLinkModal onClose={() => setLinkOpen(false)} /> : null}
    </>
  )
}
