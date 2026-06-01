// Today: the short daily to-do. ONLY clients whose follow_up_date is today or
// already past — nothing else. Calm tone: no red, no counts-as-scoreboard.
// Each row shows who, what you last discussed, how long since contact, and
// one-step actions to set the next date or log a touch.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { statusLabel, statusColor, DEAD_STATUSES } from '../lib/constants'
import { isoToday, agoLabel, daysSince, fmtTime } from '../lib/followups'
import FollowUpControls from '../components/FollowUpControls'
import ActivityComposer from '../components/ActivityComposer'

export default function Today() {
  const [clients, setClients] = useState([])
  const [acts, setActs] = useState({}) // client_id -> { last, lastBody }
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [confirmDeadId, setConfirmDeadId] = useState(null)
  const today = isoToday()

  async function load() {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .not('follow_up_date', 'is', null)
      .lte('follow_up_date', today)
    // Pre-order only: dead leads and already-ordered clients don't belong on the
    // daily nudge list (ordered clients live on Active Orders).
    const due = (data ?? [])
      .filter(c => !DEAD_STATUSES.includes(c.status) && c.status !== 'ordered')
      .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
    setClients(due)

    if (due.length) {
      const ids = due.map(c => c.id)
      const { data: a } = await supabase
        .from('activities')
        .select('client_id, body, created_at')
        .in('client_id', ids)
        .order('created_at', { ascending: false })
      const map = {}
      for (const row of a ?? []) {
        const k = row.client_id
        if (!map[k]) map[k] = { last: row.created_at, lastBody: null }
        if (!map[k].lastBody && row.body) map[k].lastBody = row.body
      }
      setActs(map)
    } else {
      setActs({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel('today')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function setFollowUp(client, iso, time = null) {
    await supabase.from('clients').update({ follow_up_date: iso, follow_up_time: time }).eq('id', client.id)
    // Realtime reload drops it off the list once pushed to a future date.
  }

  // Done = follow-up handled. Clearing the date auto-logs a 'follow_up_completed'
  // activity via DB trigger; realtime reload then drops the card off the list.
  async function markDone(client) {
    await supabase.from('clients').update({ follow_up_date: null, follow_up_time: null }).eq('id', client.id)
  }

  // Dead = lead not moving forward. Dead statuses are filtered out of the due
  // list, so the card disappears on the realtime reload.
  async function markDead(client) {
    await supabase.from('clients').update({ status: 'dead' }).eq('id', client.id)
    setConfirmDeadId(null)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Today</h1>
          <div className="muted">Who to gently check in with — today, plus anything that slipped by.</div>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="empty-state today-clear">All caught up — nothing to follow up on today.</div>
      ) : (
        <div className="today-list">
          {clients.map(c => {
            const a = acts[c.id]
            const n = daysSince(c.follow_up_date)
            return (
              <div key={c.id} className="today-card">
                <div className="today-main">
                  <div className="today-top">
                    <Link to={`/clients/${c.id}`} className="today-name">{c.name}</Link>
                    <span className="status-pill" style={{ background: statusColor(c.status).bg, color: statusColor(c.status).fg }}>
                      {statusLabel(c.status)}
                    </span>
                    {c.cooling_off && <span className="cool-badge">cooling off</span>}
                    <span className="today-due">{n <= 0 ? 'due today' : `${n} day${n === 1 ? '' : 's'} ago`}{c.follow_up_time ? ` · ${fmtTime(c.follow_up_time)}` : ''}</span>
                  </div>
                  <div className="today-discussed">
                    {a?.lastBody
                      ? <span>“{a.lastBody.length > 140 ? a.lastBody.slice(0, 140) + '…' : a.lastBody}”</span>
                      : <span className="muted">No notes yet</span>}
                  </div>
                  <div className="today-sub muted">Last contact {a?.last ? agoLabel(a.last.slice(0, 10)) : 'not yet'}</div>
                </div>
                <div className="today-actions">
                  <FollowUpControls baseDate={c.follow_up_date} coolingOff={!!c.cooling_off} selectedTime={c.follow_up_time} onPick={(iso, t) => setFollowUp(c, iso, t)} size="sm" />
                  <button type="button" className="link-btn" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    {openId === c.id ? 'Close' : 'Log touch'}
                  </button>
                  <button type="button" className="link-btn today-done" onClick={() => markDone(c)} title="Mark this follow-up handled">
                    ✓ Done
                  </button>
                  {confirmDeadId === c.id ? (
                    <span className="today-dead-confirm">
                      Mark dead?
                      <button type="button" className="link-btn link-btn-danger" onClick={() => markDead(c)}>Yes</button>
                      <button type="button" className="link-btn" onClick={() => setConfirmDeadId(null)}>No</button>
                    </span>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => setConfirmDeadId(c.id)}>
                      Mark dead
                    </button>
                  )}
                </div>
                {openId === c.id && (
                  <ActivityComposer client={c} compact onLogged={() => setOpenId(null)} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
