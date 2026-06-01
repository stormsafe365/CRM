// FollowUpsCard: the lead's "Upcoming Follow-Ups" — a table of pending
// follow-ups (Date · Type · Purpose · Assigned To · Status) with Add, Edit,
// and mark-done. Reads/writes the follow_ups table; live-updates via realtime.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { fmtLong, fmtTime } from '../lib/followups'
import FollowUpModal from './FollowUpModal'

const TYPE_ICON = { call: '📞', text: '💬', email: '✉️', note: '📝' }
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
    <div className="detail-card detail-card-full fuc-card">
      <div className="fuc-card-head">
        <div className="detail-card-title" style={{ margin: 0 }}>Upcoming Follow-Ups</div>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '10px 0' }}>Loading…</div>
      ) : pending.length === 0 ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>No upcoming follow-ups.</div>
      ) : (
        <div className="fuc-table-wrap">
          <table className="fuc-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Purpose</th><th>Assigned To</th><th>Status</th><th aria-label="actions"></th></tr>
            </thead>
            <tbody>
              {pending.map(r => (
                <tr key={r.id} className="fuc-trow" onClick={() => setModal(r)}>
                  <td>
                    <div>{fmtLong(r.due_date)}</div>
                    {r.due_time && <div className="fuc-time">{fmtTime(r.due_time)}</div>}
                  </td>
                  <td><span className="fuc-type">{TYPE_ICON[r.type] || ''} {cap(r.type)}</span></td>
                  <td>{r.purpose || '—'}</td>
                  <td>{r.assigned_to ? userLabel(users, r.assigned_to) : cap(r.audience)}</td>
                  <td><span className="fuc-status">● Pending</span></td>
                  <td className="fuc-actions" onClick={e => e.stopPropagation()}>
                    <button className="link-btn" onClick={() => setModal(r)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button type="button" className="fuc-add" onClick={() => setModal('new')}>+ Add Follow-Up</button>

      {modal && (
        <FollowUpModal
          clientId={clientId}
          followUp={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
