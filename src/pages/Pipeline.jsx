// Pipeline: a drag-and-drop kanban of the FULL sales funnel — every lead from
// New Lead through Ordered (plus Dead), not just ordered clients (that's the
// Follow-Up HQ pipeline). Drag a card to a column to set that lead's status.
// Dropping into "Ordered" opens the Mark-as-Ordered dialog so order details +
// the Follow-Up HQ timeline get captured (never a bare status flip).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { statusColor } from '../lib/constants'
import { agoLabel } from '../lib/followups'
import OrderModal from '../components/OrderModal'
import { toast } from '../lib/uiFx'

// Funnel order, left → right. Legacy statuses fold into these columns.
const COLUMNS = [
  { key: 'new_lead',      label: 'New Lead' },
  { key: 'contacted',     label: 'Attempting to Contact' },
  { key: 'working',       label: 'Working' },
  { key: 'working_hot',   label: 'Working Hot' },
  { key: 'contract_sent', label: 'Contract Sent' },
  { key: 'ordered',       label: 'Ordered' },
  { key: 'dead',          label: 'Dead' },
]
const KEYS = COLUMNS.map(c => c.key)
const normalize = (s) => {
  if (['quoted', 'follow_up'].includes(s)) return 'working'
  if (['lost', 'cancelled'].includes(s)) return 'dead'
  if (['deposit_pending', 'deposit_paid', 'scheduled', 'installed', 'done'].includes(s)) return 'ordered'
  return KEYS.includes(s) ? s : 'new_lead'
}

export default function Pipeline() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [orderClient, setOrderClient] = useState(null)
  const dragRef = useRef(null)

  async function load() {
    const { data } = await supabase.from('clients').select('*')
    setClients((data ?? []).filter(c => !c.deleted_at))
    setLoading(false)
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('pipeline')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const cols = useMemo(() => {
    const map = Object.fromEntries(KEYS.map(k => [k, []]))
    for (const c of clients) map[normalize(c.status)].push(c)
    for (const k of KEYS) {
      map[k].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    }
    return map
  }, [clients])

  async function setStatus(id, status) {
    // optimistic
    setClients(cs => cs.map(c => c.id === id ? { ...c, status } : c))
    const { error } = await supabase.from('clients').update({ status }).eq('id', id)
    if (error) { toast(error.message || 'Could not update status.'); load() }
  }

  function onDrop(colKey) {
    const id = dragRef.current
    setDragId(null); setOverCol(null); dragRef.current = null
    if (!id) return
    const c = clients.find(x => x.id === id)
    if (!c || normalize(c.status) === colKey) return
    if (colKey === 'ordered') { setOrderClient(c); return } // capture order details + seed timeline
    setStatus(id, colKey)
  }

  return (
    <div className="pipe-page">
      <div className="page-head">
        <div>
          <h2>Sales Pipeline</h2>
          <p className="muted">Every lead from first contact to ordered. Drag a card to move it through the funnel.</p>
        </div>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      ) : (
        <div className="kb-board">
          {COLUMNS.map(col => {
            const list = cols[col.key]
            const sc = statusColor(col.key)
            return (
              <div
                key={col.key}
                className={`kb-col${overCol === col.key ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (overCol !== col.key) setOverCol(col.key) }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(c => c === col.key ? null : c) }}
                onDrop={(e) => { e.preventDefault(); onDrop(col.key) }}
              >
                <div className="kb-col-head">
                  <span className="kb-dot" style={{ background: sc.fg }} />
                  <span className="kb-col-label">{col.label}</span>
                  <span className="kb-col-count">{list.length}</span>
                </div>
                <div className="kb-list">
                  {list.map(c => {
                    const csc = statusColor(c.status)
                    return (
                      <div
                        key={c.id}
                        className={`kb-card${dragId === c.id ? ' dragging' : ''}`}
                        style={{ borderLeftColor: csc.fg }}
                        draggable
                        onDragStart={(e) => { dragRef.current = c.id; setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id) }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); dragRef.current = null }}
                        onClick={() => navigate(`/clients/${c.id}`)}
                        title="Open client"
                      >
                        <div className="kb-name">{c.name || 'Unnamed'}</div>
                        <div className="kb-sub">{[c.building_size, c.county && `${c.county} County`].filter(Boolean).join(' · ') || '—'}</div>
                        <div className="kb-meta">
                          {c.phone && <span>{c.phone}</span>}
                          {c.follow_up_date && <span className="kb-fu">↻ {agoLabel(c.follow_up_date)}</span>}
                        </div>
                      </div>
                    )
                  })}
                  {list.length === 0 && <div className="kb-empty">—</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {orderClient && (
        <OrderModal
          client={orderClient}
          onClose={() => setOrderClient(null)}
          onSaved={() => { setOrderClient(null); load() }}
        />
      )}
    </div>
  )
}
