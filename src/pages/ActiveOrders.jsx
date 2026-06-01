// ActiveOrders: every client with status = 'ordered', grouped by project_stage
// (ordered → engineering → permitting → scheduling → installed, + revisions).
// Each card shows last activity, follow-up, and a quiet "needs an update" flag
// after STALE_ORDER_DAYS of silence — so neither the customer nor the factory
// gets left hanging. Log client OR factory check-ins right on the card.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PROJECT_STAGES, projectStageColor } from '../lib/constants'
import { STALE_ORDER_DAYS, agoLabel, daysSince, fmtLong } from '../lib/followups'
import ActivityComposer from '../components/ActivityComposer'

export default function ActiveOrders() {
  const [orders, setOrders] = useState([])
  const [acts, setActs] = useState({}) // client_id -> most recent activity timestamp
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)

  async function load() {
    const { data } = await supabase.from('clients').select('*').eq('status', 'ordered')
    const list = data ?? []
    setOrders(list)
    if (list.length) {
      const ids = list.map(c => c.id)
      const { data: a } = await supabase
        .from('activities')
        .select('client_id, created_at')
        .in('client_id', ids)
        .order('created_at', { ascending: false })
      const map = {}
      for (const row of a ?? []) if (!map[row.client_id]) map[row.client_id] = row.created_at
      setActs(map)
    } else {
      setActs({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel('orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const byStage = {}
  for (const s of PROJECT_STAGES) byStage[s.value] = []
  for (const o of orders) {
    const st = o.project_stage && byStage[o.project_stage] ? o.project_stage : 'ordered'
    byStage[st].push(o)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Active Orders</h1>
          <div className="muted">Every ordered build, by stage — keep the customer and the factory in the loop.</div>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="empty-state">No active orders yet. Clients marked “Ordered” show up here.</div>
      ) : (
        PROJECT_STAGES.map(stage => {
          const list = byStage[stage.value]
          if (!list.length) return null
          return (
            <div key={stage.value} className="orders-stage">
              <div className="orders-stage-head">
                <span className="status-pill" style={{ background: projectStageColor(stage.value).bg, color: projectStageColor(stage.value).fg }}>
                  {stage.label}
                </span>
                <span className="orders-stage-count">{list.length}</span>
              </div>
              <div className="orders-grid">
                {list.map(o => {
                  const last = acts[o.id]
                  const stale = !last || daysSince(last.slice(0, 10)) > STALE_ORDER_DAYS
                  return (
                    <div key={o.id} className={`order-card ${stale ? 'stale' : ''}`}>
                      <div className="order-top">
                        <Link to={`/clients/${o.id}`} className="order-name">{o.name}</Link>
                        {!o.payment_cleared && <span className="pay-badge warn">deposit pending</span>}
                      </div>
                      <div className="order-meta">
                        <span>Last update <b>{last ? agoLabel(last.slice(0, 10)) : 'none yet'}</b></span>
                        <span>Follow-up <b>{o.follow_up_date ? fmtLong(o.follow_up_date) : '—'}</b></span>
                      </div>
                      {stale && <span className="needs-update">needs an update</span>}
                      <div className="order-actions">
                        <button type="button" className="link-btn" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                          {openId === o.id ? 'Close' : 'Log update'}
                        </button>
                        <Link to={`/clients/${o.id}`} className="link-btn">Open timeline</Link>
                      </div>
                      {openId === o.id && <ActivityComposer client={o} showAudience compact onLogged={() => setOpenId(null)} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
