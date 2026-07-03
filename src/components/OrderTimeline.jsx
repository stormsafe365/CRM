// OrderTimeline: an ordered client's milestone follow-ups — the same auto chain
// you see in Follow-Up HQ — shown AND editable right on the client page.
//
// The milestones live in the Follow-Up HQ calendar's localStorage ('ssfu_v8'),
// not Supabase. The calendar is a same-origin iframe, so we share its store.
// Checking a milestone here runs the identical gate-spawn engine (ssfuEngine.js),
// so progress made on the client page and in Follow-Up HQ stay in sync.

import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { isoToday, daysBetween, fmtLong } from '../lib/followups'
import { readState, followupsForClient, toggleFollowupForClient } from '../lib/ssfuEngine'
import { toast } from '../lib/uiFx'

// Mirrors the calendar's TYPES palette so it reads as the same timeline.
const TYPE_META = {
  mfr:    { label: 'Manufacturer', color: '#cbd5e1' },
  pay:    { label: 'Invoice',      color: '#a5b4fc' },
  plans:  { label: 'Plans',        color: '#60a5fa' },
  permit: { label: 'Permit',       color: '#94a3b8' },
  site:   { label: 'Site / Pad',   color: '#fb923c' },
  install:{ label: 'Install',      color: '#2dd4bf' },
  call:   { label: 'Check-in',     color: '#7dd3fc' },
  review: { label: 'Completion',   color: '#fbbf24' },
}

// "Order Confirmation — confirm the manufacturer…" → title + rest.
function splitNote(note) {
  const s = String(note || '')
  const i = s.indexOf(' — ')
  return i > -1 ? { title: s.slice(0, i), body: s.slice(i + 3) } : { title: s, body: '' }
}

function relLabel(date, done) {
  if (!date) return ''
  const d = daysBetween(date, isoToday()) // >0 = past
  if (done) return ''
  if (d === 0) return 'Today'
  if (d > 0) return `${d} day${d === 1 ? '' : 's'} overdue`
  const n = -d
  return `in ${n} day${n === 1 ? '' : 's'}`
}

// null = calendar never opened in this browser; [] = opened, none for this client
function load(clientId) {
  const state = readState()
  return state ? followupsForClient(state, clientId) : null
}

export default function OrderTimeline({ client }) {
  const [fus, setFus] = useState(() => load(client.id))

  useEffect(() => {
    const refresh = () => setFus(load(client.id))
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [client.id])

  const today = isoToday()
  const { open, overdue, doneCount } = useMemo(() => {
    const list = fus || []
    const o = list.filter(f => !f.done)
    return {
      open: o.length,
      overdue: o.filter(f => f.date && f.date < today).length,
      doneCount: list.filter(f => f.done).length,
    }
  }, [fus, today])

  function toggle(f) {
    const next = toggleFollowupForClient(client.id, f.id)
    if (next == null) { toast('Open Follow-Up HQ once to set up this order’s timeline first.'); return }
    setFus(next)
    const wasDone = f.done
    if (!wasDone && f.gate) toast('Milestone done — next step added to the timeline.', 'success')
  }

  if (client.status !== 'ordered') return null

  const list = fus || []

  return (
    <section className="card card-pad ot-card">
      <div className="section-head">
        <h3>Order Timeline</h3>
        <Link to="/calendar" className="link-cyan">Open in Follow-Up HQ →</Link>
      </div>

      {fus === null ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>
          Open <Link to="/calendar" className="link-cyan">Follow-Up HQ</Link> once to build this order’s milestone timeline.
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>
          No milestones yet — they generate in Follow-Up HQ when the order is processed.
        </div>
      ) : (
        <>
          <div className="ot-stats">
            <span><b className={overdue ? 'ot-od' : ''}>{overdue}</b> overdue</span>
            <span><b>{open}</b> open</span>
            <span><b>{doneCount}</b> done</span>
            <span className="ot-hint">Click a circle to mark done</span>
          </div>
          <div className="ot-rail">
            {list.map(f => {
              const meta = TYPE_META[f.type] || { label: f.type, color: '#94a3b8' }
              const { title, body } = splitNote(f.note)
              const od = !f.done && f.date && f.date < today
              const rel = relLabel(f.date, f.done)
              return (
                <div key={f.id} className={`ot-item${f.done ? ' done' : ''}${od ? ' overdue' : ''}`}>
                  <button
                    type="button"
                    className="ot-node"
                    style={{ '--ot-c': meta.color }}
                    onClick={() => toggle(f)}
                    title={f.done ? 'Mark not done' : 'Mark done'}
                    aria-pressed={f.done}
                  >
                    {f.done
                      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      : null}
                  </button>
                  <div className="ot-main">
                    <div className="ot-top">
                      <span className="ot-title">{title}</span>
                      <span className="ot-type" style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                    <div className="ot-date">
                      <span className="num">{fmtLong(f.date)}</span>
                      {rel && <span className={`ot-rel${od ? ' od' : ''}`}>{rel}</span>}
                      {f.gate && !f.done && <span className="ot-gate">milestone</span>}
                    </div>
                    {body && <div className="ot-body">{body}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
