// DashCalendar: the dashboard's follow-up calendar. Inline it shows a COMPACT
// 7-day week strip (the current week) so it doesn't eat ~40% of the viewport;
// the Expand button opens the full month. Plots every client's next follow-up
// (clients.follow_up_date); ordered jobs are color-coded. Click a day to see
// that day's follow-ups (each links to the client). Live-updates via realtime.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { statusLabel } from '../lib/constants'
import { isoToday, fmtTime } from '../lib/followups'
import { readState } from '../lib/ssfuEngine'

const MNAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const chevL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
const chevR = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
const xIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>

const pad = (n) => String(n).padStart(2, '0')
const toIso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
const parseIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const addDaysIso = (iso, n) => { const dt = parseIso(iso); dt.setDate(dt.getDate() + n); return toIso(dt) }
const startOfWeekIso = (iso) => { const dt = parseIso(iso); dt.setDate(dt.getDate() - dt.getDay()); return toIso(dt) }
function weekLabel(startIso) {
  const s = startIso.split('-').map(Number), e = addDaysIso(startIso, 6).split('-').map(Number)
  return s[1] === e[1] ? `${MSHORT[s[1] - 1]} ${s[2]} – ${e[2]}` : `${MSHORT[s[1] - 1]} ${s[2]} – ${MSHORT[e[1] - 1]} ${e[2]}`
}

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
    cells.push({ muted: false, day: d, iso: `${year}-${pad(month + 1)}-${pad(d)}` })
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
  const [viewY, setViewY] = useState(todayY)   // month view (Expand modal)
  const [viewM, setViewM] = useState(todayM)
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(todayISO)) // inline week strip
  const [clients, setClients] = useState([])
  const [ssfu, setSsfu] = useState(() => readState()) // Follow-Up HQ milestone store (ssfu_v8)
  const [expanded, setExpanded] = useState(false)
  const [dayModal, setDayModal] = useState(null)

  // Re-read the Follow-Up HQ store when returning to the tab / after it changes.
  useEffect(() => {
    const refresh = () => setSsfu(readState())
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) }
  }, [])

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

  // Unified events by day: legacy client follow-ups (Supabase) + Follow-Up HQ
  // milestone follow-ups (ssfu_v8). Each event: { id, name, date, cls, clientId, sub, time }.
  const eventsByDay = useMemo(() => {
    const map = {}
    const add = (ev) => { if (!ev.date) return; (map[ev.date] = map[ev.date] || []).push(ev) }
    for (const c of clients) {
      add({ id: 'crm-' + c.id, name: c.name, date: c.follow_up_date, cls: eventClass(c, todayISO), clientId: c.id, sub: statusLabel(c.status), time: c.follow_up_time })
    }
    if (ssfu && Array.isArray(ssfu.followups)) {
      const nameBy = {}
      ;(ssfu.clients || []).forEach(cc => { nameBy[cc.id] = cc.name })
      for (const f of ssfu.followups) {
        if (f.done || !f.date) continue // open milestones only
        const clientId = String(f.client || '').replace(/^crm-/, '')
        add({
          id: 'fu-' + f.id, name: nameBy[f.client] || nameBy['crm-' + clientId] || 'Client',
          date: f.date, cls: f.date < todayISO ? 'storm' : 'install', clientId,
          sub: String(f.note || '').split(' — ')[0] || 'Follow-up',
        })
      }
    }
    return map
  }, [clients, ssfu, todayISO])

  const grid = useMemo(() => buildGrid(viewY, viewM), [viewY, viewM])
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const iso = addDaysIso(weekStart, i); const dt = parseIso(iso); return { iso, day: dt.getDate(), dow: DOW[dt.getDay()] } }),
    [weekStart]
  )

  function prevMonth() { setViewM(m => (m === 0 ? (setViewY(y => y - 1), 11) : m - 1)) }
  function nextMonth() { setViewM(m => (m === 11 ? (setViewY(y => y + 1), 0) : m + 1)) }

  // ---- inline WEEK STRIP ----
  const weekStrip = (
    <>
      <div className="cal-week">
        {weekDays.map(d => {
          const ev = eventsByDay[d.iso] || []
          const shown = ev.slice(0, 3)
          const extra = ev.length - shown.length
          return (
            <div key={d.iso}
              className={`cwk-day${d.iso === todayISO ? ' today' : ''}${ev.length ? '' : ' empty'}`}
              onClick={() => ev.length && setDayModal(d.iso)}
              style={{ cursor: ev.length ? 'pointer' : 'default' }}>
              <div className="cwk-head"><span className="cwk-dow">{d.dow}</span><span className="cwk-num">{d.day}</span></div>
              <div className="cwk-events">
                {shown.map(c => (
                  <div key={c.id} className={`cd-event ${c.cls}`} title={c.name}>
                    {c.name}{c.time ? ` · ${fmtTime(c.time)}` : ''}
                  </div>
                ))}
                {extra > 0 && <div className="cd-more">+ {extra} more</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="cal-legend">
        <span><i style={{ background: '#22c4bf' }} />Follow-up</span>
        <span><i style={{ background: '#61d89e' }} />Ordered job</span>
        <span><i style={{ background: 'rgba(255,92,92,0.55)' }} />Overdue</span>
      </div>
    </>
  )

  // ---- full MONTH grid (Expand modal) ----
  const monthGridEl = (
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
                  <div key={c.id} className={`cd-event ${c.cls}`} title={c.name}>
                    {c.name}{c.time ? ` · ${fmtTime(c.time)}` : ''}
                  </div>
                ))}
                {extra > 0 && <div className="cd-more">+ {extra} more</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="cal-legend">
        <span><i style={{ background: '#22c4bf' }} />Follow-up</span>
        <span><i style={{ background: '#61d89e' }} />Ordered job</span>
        <span><i style={{ background: 'rgba(255,92,92,0.55)' }} />Overdue</span>
      </div>
    </>
  )

  return (
    <>
      <div className="panel">
        <div className="panel-title" style={{ alignItems: 'center' }}>
          <h3>Follow-Up Calendar · <span style={{ color: 'var(--cyan)' }}>{weekLabel(weekStart)}</span></h3>
          <div className="cal-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="icon-btn" onClick={() => setWeekStart(w => addDaysIso(w, -7))} aria-label="Previous week">{chevL}</button>
            <button className="btn btn-ghost" onClick={() => setWeekStart(startOfWeekIso(todayISO))}>This Week</button>
            <button className="icon-btn" onClick={() => setWeekStart(w => addDaysIso(w, 7))} aria-label="Next week">{chevR}</button>
            <button className="btn btn-ghost" onClick={() => { setViewY(todayY); setViewM(todayM); setExpanded(true) }}>Expand</button>
          </div>
        </div>
        {weekStrip}
      </div>

      {expanded && (
        <div className="scrim open" onClick={(e) => { if (e.target.classList.contains('scrim')) setExpanded(false) }}>
          <div className="modal wide" role="dialog" aria-modal="true" style={{ maxWidth: 1100 }}>
            <div className="modal-head">
              <div className="mt"><div><h3>Follow-Up Calendar</h3><div className="sub">{MNAMES[viewM]} {viewY}</div></div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="cal-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="icon-btn" onClick={prevMonth} aria-label="Previous month">{chevL}</button>
                  <button className="btn btn-ghost" onClick={() => { setViewY(todayY); setViewM(todayM) }}>Today</button>
                  <button className="icon-btn" onClick={nextMonth} aria-label="Next month">{chevR}</button>
                </div>
                <div className="modal-close" onClick={() => setExpanded(false)}>{xIcon}</div>
              </div>
            </div>
            <div className="modal-body">{monthGridEl}</div>
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
                <div key={c.id} onClick={() => { setDayModal(null); navigate(`/clients/${c.clientId}`) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer' }}>
                  <span className={`cd-event ${c.cls}`} style={{ margin: 0, padding: '5px 9px' }}>{c.cls === 'install' ? 'Ordered' : c.cls === 'storm' ? 'Overdue' : 'Lead'}</span>
                  <span style={{ color: 'var(--fg)', fontSize: 13.5, flex: 1 }}>{c.name}</span>
                  <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>{c.sub}{c.time ? ` · ${fmtTime(c.time)}` : ''}</span>
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
