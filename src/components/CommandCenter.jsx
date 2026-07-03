// CommandCenter: a right-side drawer that surfaces "what needs attention" as
// prioritized, clickable cards — the free, deterministic version of the AI
// Command Center spec. NO LLM, no API key, no cost. Every view is a plain
// query over the clients/quotes you already have, presented as actionable
// cards (Open Client / Draft Email). A name box on top doubles as instant
// client lookup. Same data the Dashboard/Today/Follow-Ups pages use.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isoToday, daysSince, fmtLong, addDays, STALE_ORDER_DAYS } from '../lib/followups'
import { statusLabel, statusColor, DEAD_STATUSES } from '../lib/constants'
import { MESSAGE_TEMPLATES } from '../lib/messageTemplates'

const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'verbal_accept']
const QUOTE_VALUE_FLOOR = 30000

const money = (n) => {
  const v = Number(n) || 0
  return v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'K' : '$' + Math.round(v)
}
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'there'

// Pick a sensible template per view and open the mail client (free — no AI).
// target=_blank so Electron routes mailto through shell.openExternal.
function mailtoFor(client, kind) {
  const tplLabel = {
    attention: '+2 weeks · light check-in',
    quotesNoFollowup: '+2 weeks · light check-in',
    openQuotes: 'Reason to reach out (price/season/permits)',
    hotNoQuote: '+3 days · nice to meet',
    stalledOrders: 'Ordered · production update',
    pendingDeposits: 'Ordered · production update',
    awaitingPermits: 'Ordered · production update',
  }[kind] || '+2 weeks · light check-in'
  const tpl = MESSAGE_TEMPLATES.find(t => t.label === tplLabel) || MESSAGE_TEMPLATES[1]
  const body = tpl.text.replaceAll('[First Name]', firstName(client.name))
  const subject = 'StormSafe Steel — your building'
  return `mailto:${client.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function CommandCenter({ open, onClose }) {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('attention')
  const [q, setQ] = useState('')

  // Load once each time the drawer opens (cheap; same select('*') the Dashboard uses).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [c, qr] = await Promise.all([
        supabase.from('clients').select('*'),
        supabase.from('quotes').select('id, client_id, status, total_amount, created_at, deleted_at'),
      ])
      if (cancelled) return
      setClients((c.data ?? []).filter(x => !x.deleted_at))
      setQuotes((qr.data ?? []).filter(x => !x.deleted_at))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open])

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const today = isoToday()
  const weekAgo = addDays(today, -7)

  // quote rollups keyed by client
  const qByClient = useMemo(() => {
    const m = new Map()
    for (const qt of quotes) {
      if (!m.has(qt.client_id)) m.set(qt.client_id, [])
      m.get(qt.client_id).push(qt)
    }
    return m
  }, [quotes])
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])

  // ---- the views (deterministic queries) ----
  const data = useMemo(() => {
    const alive = clients.filter(c => !DEAD_STATUSES.includes(c.status))
    const orderAge = (c) => (c.order_date ? daysSince(c.order_date) : null)

    const attention = alive
      .filter(c => c.status !== 'ordered' && c.follow_up_date && c.follow_up_date <= today)
      .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
      .map(c => {
        const od = daysSince(c.follow_up_date)
        return { c, why: od > 0 ? `${od} day${od === 1 ? '' : 's'} overdue` : 'Due today', flag: od > 0 }
      })

    const hotNoQuote = alive
      .filter(c => c.status === 'working_hot' && !(qByClient.get(c.id)?.length))
      .map(c => ({ c, why: 'Hot lead · no quote on file', flag: true }))

    const openQuotes = quotes
      .filter(qt => OPEN_QUOTE_STATUSES.includes(qt.status) && (Number(qt.total_amount) || 0) >= QUOTE_VALUE_FLOOR)
      .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
      .map(qt => {
        const c = clientById.get(qt.client_id)
        return c ? { c, why: `${money(qt.total_amount)} · ${statusLabel(qt.status)}`, flag: false } : null
      })
      .filter(Boolean)

    const quotesNoFollowup = quotes
      .filter(qt => OPEN_QUOTE_STATUSES.includes(qt.status) && qt.created_at && qt.created_at.slice(0, 10) <= weekAgo)
      .map(qt => {
        const c = clientById.get(qt.client_id)
        if (!c || DEAD_STATUSES.includes(c.status)) return null
        const noFu = !c.follow_up_date || c.follow_up_date < today
        return noFu ? { c, why: `${money(qt.total_amount)} · quoted ${fmtLong(qt.created_at.slice(0, 10))}, no follow-up set`, flag: true } : null
      })
      .filter(Boolean)
      // de-dupe by client (a client with several stale quotes shows once)
      .filter((x, i, arr) => arr.findIndex(y => y.c.id === x.c.id) === i)

    const stalledOrders = alive
      .filter(c => c.status === 'ordered'
        && ['ordered', 'engineering', null, undefined].includes(c.project_stage)
        && orderAge(c) != null && orderAge(c) >= STALE_ORDER_DAYS)
      .sort((a, b) => orderAge(b) - orderAge(a))
      .map(c => ({ c, why: `${orderAge(c)} days since order · confirm manufacturer has it`, flag: true }))

    const pendingDeposits = clients
      .filter(c => c.status === 'ordered' && !c.payment_cleared)
      .map(c => ({ c, why: 'Deposit not cleared yet', flag: true }))

    const awaitingPermits = clients
      .filter(c => c.status === 'ordered' && c.project_stage === 'permitting' && !c.order_exempt)
      .map(c => ({ c, why: 'In permitting' + (c.county ? ` · ${c.county} County` : ''), flag: false }))

    return { attention, hotNoQuote, openQuotes, quotesNoFollowup, stalledOrders, pendingDeposits, awaitingPermits }
  }, [clients, quotes, qByClient, clientById, today, weekAgo])

  const VIEWS = [
    { key: 'attention',        label: 'Needs Attention',     items: data.attention },
    { key: 'hotNoQuote',       label: 'Hot · No Quote',      items: data.hotNoQuote },
    { key: 'openQuotes',       label: `Quotes ≥ ${money(QUOTE_VALUE_FLOOR)}`, items: data.openQuotes },
    { key: 'quotesNoFollowup', label: 'Quotes · No Follow-Up', items: data.quotesNoFollowup },
    { key: 'stalledOrders',    label: 'Stalled Orders',      items: data.stalledOrders },
    { key: 'pendingDeposits',  label: 'Pending Deposits',    items: data.pendingDeposits },
    { key: 'awaitingPermits',  label: 'Awaiting Permits',    items: data.awaitingPermits },
  ]

  // Name lookup overrides the active view when the box has text.
  const searching = q.trim().length > 0
  const matches = useMemo(() => {
    if (!searching) return []
    const needle = q.trim().toLowerCase()
    return clients
      .filter(c => (c.name || '').toLowerCase().includes(needle)
        || (c.phone || '').includes(needle)
        || (c.county || '').toLowerCase().includes(needle))
      .slice(0, 30)
      .map(c => ({ c, why: statusLabel(c.status) + (c.building_size ? ` · ${c.building_size}` : ''), flag: false }))
  }, [q, clients, searching])

  const active = VIEWS.find(v => v.key === view) || VIEWS[0]
  const list = searching ? matches : active.items

  function goClient(id) { onClose(); navigate(`/clients/${id}`) }

  const briefing = [
    { n: data.attention.filter(x => x.flag).length, label: 'overdue' },
    { n: data.attention.filter(x => !x.flag).length, label: 'due today' },
    { n: data.hotNoQuote.length, label: 'hot · no quote' },
    { n: data.pendingDeposits.length, label: 'pending deposits' },
    { n: data.stalledOrders.length, label: 'stalled orders' },
  ]

  return (
    <>
      <div className={`cmd-scrim${open ? ' show' : ''}`} onClick={onClose} aria-hidden={!open} />
      <aside className={`cmd-drawer${open ? ' open' : ''}`} role="dialog" aria-label="StormSafe Command Center" aria-hidden={!open}>
        <div className="cmd-head">
          <div>
            <div className="cmd-title">STORM<b>SAFE</b> COMMAND CENTER</div>
            <div className="cmd-sub">What needs your attention — {fmtLong(today)}</div>
          </div>
          <button className="cmd-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Daily briefing strip */}
        <div className="cmd-brief">
          {briefing.map((b, i) => (
            <div className="cmd-stat" key={i}>
              <span className={`cmd-stat-n${b.n > 0 ? ' hot' : ''}`}>{b.n}</span>
              <span className="cmd-stat-l">{b.label}</span>
            </div>
          ))}
        </div>

        {/* Lookup */}
        <div className="cmd-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Look up a client by name, phone, or county…" />
          {searching && <button className="cmd-clear" onClick={() => setQ('')} aria-label="Clear">✕</button>}
        </div>

        {/* View chips (hidden while searching) */}
        {!searching && (
          <div className="cmd-chips">
            {VIEWS.map(v => (
              <button
                key={v.key}
                className={`cmd-chip${view === v.key ? ' active' : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
                <span className="cmd-chip-n">{v.items.length}</span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="cmd-list">
          {loading ? (
            <div className="cmd-empty">Loading…</div>
          ) : list.length === 0 ? (
            <div className="cmd-empty">
              {searching ? 'No clients match that.' : 'Nothing here — you’re all caught up. 🎉'}
            </div>
          ) : (
            list.map(({ c, why, flag }) => {
              const sc = statusColor(c.status)
              return (
                <div className="cmd-card" key={c.id + why}>
                  <div className="cmd-card-top">
                    <button className="cmd-name" onClick={() => goClient(c.id)}>{c.name || 'Unnamed'}</button>
                    <span className="cmd-pill" style={{ background: sc.bg, color: sc.fg }}>{statusLabel(c.status)}</span>
                  </div>
                  <div className="cmd-meta">
                    {[c.building_size, c.county && `${c.county} County`].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className={`cmd-why${flag ? ' flag' : ''}`}>{why}</div>
                  <div className="cmd-actions">
                    <button className="cmd-btn" onClick={() => goClient(c.id)}>Open Client</button>
                    {c.email && (
                      <a className="cmd-btn ghost" href={mailtoFor(c, view)} target="_blank" rel="noreferrer">Draft Email</a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}
