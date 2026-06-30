// DashCalendar: a month calendar for the dashboard that plots every client's
// next follow-up (clients.follow_up_date). Ordered jobs are color-coded so
// post-sale follow-ups stand out. Flip months, jump to Today, click a day to
// see that day's follow-ups (each links to the client), and Expand to a
// full-screen month view. Live-updates via realtime. Reuses the design's
// .cal-grid / .cal-day / .cd-event styles.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { statusLabel } from '../lib/constants'
import { isoToday, fmtTime } from '../lib/followups'

const MNAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const chevL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
const chevR = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
const xIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>

// ordered jobs = lime (install), overdue = red (storm), else cyan (task)
function eventClass(c, todayISO) {
  if (c.status === 'ordered') return 'install'
  if (c.follow_up_date < todayISO) return 'storm'
  return 'task'
}

function buildGrid(year, month) {
  const startDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = startDow - 1; i >= 0; i--) cells.push({ muted: true, day: prevDays - i })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ muted: false, day: d, iso: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` })
  }
  const trailing = (Math.ceil(cells.length / 7) * 7) - cells.length
  for (let j = 1; j <= trailing; j++) cells.push({ muted: true, day: j })
  return cells
}

function dayTitle(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MNAMES[m - 1]} ${d}, ${y}`
}

export default function DashCalendar() {
  const navigate = useNavigate()
  const todayISO = isoToday()
  const [todayY, todayM] = [Number(todayISO.slice(0, 4)), Number(todayISO.slice(5, 7)) - 1]
  const [viewY, setViewY] = useState(todayY)
  const [viewM, setViewM] = useState(todayM)
  const [clients, setClients] = useState([])
  const [expanded, setExpanded] = useState(false)
  const [dayModal, setDayModal] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('clients')
        .select('id, name, status, project_stage, follow_up_date, follow_up_time, deleted_at')
        .not('follow_up_date', 'is', null)
      if (!cancelled) setClients((data ?? []).filter(c => !c.deleted_at))
    }
    load()
    const ch = supabase.channel('dash-cal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [])

  const eventsByDay = useMemo(() => {
    const map = {}
    for (const c of clients) {
      if (!c.follow_up_date) continue
      ;(map[c.follow_up_date] = map[c.follow_up_date] || []).push(c)
    }
    return map
  }, [clients])

  const grid = useMemo(() => buildGrid(viewY, viewM), [viewY, viewM])

  function prevMonth() { setViewM(m => (m === 0 ? (setViewY(y => y - 1), 11) : m - 1)) }
  function nextMonth() { setViewM(m => (m === 11 ? (setViewY(y => y + 1), 0) : m + 1)) }
  function goToday() { setViewY(todayY); setViewM(todayM) }

  const calGrid = (
    <>
      <div className="cal-grid">
        {DOW.map(d => <div key={d} className="cal-head">{d}</div>)}
        {grid.map((cell, i) => {
          if (cell.muted) return <div key={i} className="cal-day muted"><div className="cd-num">{cell.day}</div></div>
          const ev = eventsByDay[cell.iso] || []
          const shown = ev.slice(0, 3)
          const extra = ev.length - shown.length
          return (
            <div key={i} className={`cal-day${cell.iso === todayISO ? ' today' : ''}`}
              onClick={() => ev.length && setDayModal(cell.iso)} style={{ cursor: ev.length ? 'pointer' : 'default' }}>
              <div className="cd-num">{cell.day}</div>
              <div className="cd-events">
                {shown.map(c => (
                  <div key={c.id} className={`cd-event ${eventClass(c, todayISO)}`} title={c.name}>
                    {c.name}{c.follow_up_time ? ` · ${fmtTime(c.follow_up_time)}` : ''}
                  </div>
                ))}
                {extra > 0 && <div className="cd-more">+ {extra} more</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="cal-legend">
        <span><i style={{ background: 'rgba(9,214,220,0.55)' }} />Follow-up</span>
        <span><i style={{ background: 'rgba(143,209,79,0.65)' }} />Ordered job</span>
        <span><i style={{ background: 'rgba(255,92,92,0.55)' }} />Overdue</span>
      </div>
    </>
  )

  const toolbar = (extra) => (
    <div className="cal-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="icon-btn" onClick={prevMonth} aria-label="Previous month">{chevL}</button>
      <button className="btn btn-ghost" onClick={goToday}>Today</button>
      <button className="icon-btn" onClick={nextMonth} aria-label="Next month">{chevR}</button>
      {extra}
    </div>
  )

  return (
    <>
      <div className="panel">
        <div className="panel-title" style={{ alignItems: 'center' }}>
          <h3>Follow-Up Calendar · <span style={{ color: 'var(--cyan)' }}>{MNAMES[viewM]} {viewY}</span></h3>
          {toolbar(<button className="btn btn-ghost" onClick={() => setExpanded(true)}>Expand</button>)}
        </div>
        {calGrid}
      </div>

      {expanded && (
        <div className="scrim open" onClick={(e) => { if (e.target.classList.contains('scrim')) setExpanded(false) }}>
          <div className="modal wide" role="dialog" aria-modal="true" style={{ maxWidth: 1100 }}>
            <div className="modal-head">
              <div className="mt"><div><h3>Follow-Up Calendar</h3><div className="sub">{MNAMES[viewM]} {viewY}</div></div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {toolbar()}
                <div className="modal-close" onClick={() => setExpanded(false)}>{xIcon}</div>
              </div>
            </div>
            <div className="modal-body">{calGrid}</div>
          </div>
        </div>
      )}

      {dayModal && (
        <div className="scrim open" onClick={(e) => { if (e.target.classList.contains('scrim')) setDayModal(null) }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="mt"><div><h3>{dayTitle(dayModal)}</h3><div className="sub">{(eventsByDay[dayModal] || []).length} follow-up{(eventsByDay[dayModal] || []).length === 1 ? '' : 's'}</div></div></div>
              <div className="modal-close" onClick={() => setDayModal(null)}>{xIcon}</div>
            </div>
            <div className="modal-body">
              {(eventsByDay[dayModal] || []).map(c => (
                <div key={c.id} onClick={() => { setDayModal(null); navigate(`/clients/${c.id}`) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}>
                  <span className={`cd-event ${eventClass(c, todayISO)}`} style={{ margin: 0, padding: '5px 9px' }}>{c.status === 'ordered' ? 'Ordered' : 'Lead'}</span>
                  <span style={{ color: 'var(--fg)', fontSize: 13.5, flex: 1 }}>{c.name}</span>
                  <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>{statusLabel(c.status)}{c.follow_up_time ? ` · ${fmtTime(c.follow_up_time)}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setDayModal(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}
