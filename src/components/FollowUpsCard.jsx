// FollowUpsCard: the lead's "Upcoming Follow-Ups" — a table of pending
// follow-ups (Date · Type · Purpose · Assigned To · Status) with Add, Edit,
// and mark-done. Reads/writes the follow_ups table; live-updates via realtime.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { fmtLong, fmtTime } from '../lib/followups'
import FollowUpModal from './FollowUpModal'

const ic = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
const TYPE_SVG = {
  call: ic(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />),
  email: ic(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>),
  text: ic(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  note: ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
}
const TYPE_CLASS = { call: 'call', email: 'email', text: 'text', note: 'email' }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export default function FollowUpsCard({ clientId }) {
  const { users } = useUsers()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'new' | followUp row

  async function load() {
    const { data } = await supabase
      .from('follow_ups')
      .select('*')
      .eq('client_id', clientId)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true, nullsFirst: true })
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`fu-card-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups', filter: `client_id=eq.${clientId}` }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const pending = rows.filter(r => r.status === 'pending')

  return (
    <section className="card card-pad fuc-card">
      <div className="section-head">
        <h3>Upcoming Follow-Ups</h3>
        <span className="link-cyan" role="button" onClick={() => setModal('new')}>View all</span>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '10px 0' }}>Loading…</div>
      ) : pending.length === 0 ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>No upcoming follow-ups.</div>
      ) : (
        <table className="fu-table">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Purpose</th><th>Assigned To</th><th>Status</th></tr>
          </thead>
          <tbody>
            {pending.map(r => (
              <tr key={r.id} className="fuc-trow" onClick={() => setModal(r)} style={{ cursor: 'pointer' }}>
                <td className="fu-date">
                  <div className="d num">{fmtLong(r.due_date)}</div>
                  {r.due_time && <div className="t num">{fmtTime(r.due_time)}</div>}
                </td>
                <td><span className={`fu-type ${TYPE_CLASS[r.type] || 'call'}`}>{TYPE_SVG[r.type] || TYPE_SVG.call}{cap(r.type)}</span></td>
                <td className="fu-purpose">{r.purpose || '—'}</td>
                <td className="fu-assigned">{r.assigned_to ? userLabel(users, r.assigned_to) : cap(r.audience)}</td>
                <td><span className="status-pending"><span className="dot" />Pending</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <span className="add-followup" role="button" onClick={() => setModal('new')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>Add Follow-Up
      </span>

      {modal && (
        <FollowUpModal
          clientId={clientId}
          followUp={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </section>
  )
}
