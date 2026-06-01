// ActivityTimeline: the activity composer + a live history for one client.
// Shows manual touches AND the auto-logged events (status / quote / follow-up).
// Both client and factory check-ins live on this one timeline.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import ActivityComposer from './ActivityComposer'

const TYPE_META = {
  call: { icon: '📞', label: 'Call' },
  note: { icon: '📝', label: 'Note' },
  email: { icon: '✉️', label: 'Email' },
  meeting: { icon: '🤝', label: 'Meeting' },
  status_change: { icon: '↪', label: 'Status change' },
  quote_created: { icon: '📄', label: 'Quote created' },
  quote_status_change: { icon: '📄', label: 'Quote update' },
  follow_up_set: { icon: '📅', label: 'Follow-up set' },
  follow_up_completed: { icon: '✓', label: 'Follow-up cleared' },
}

export default function ActivityTimeline({ client, showAudience = false }) {
  const { users } = useUsers()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('client_id', client.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      setItems(data ?? [])
      setLoading(false)
    }
    load()
    const ch = supabase
      .channel(`acts-${client.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'activities', filter: `client_id=eq.${client.id}` },
        () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [client.id])

  return (
    <div className="detail-card detail-card-full timeline-card">
      <div className="detail-card-title">Activity</div>
      <ActivityComposer client={client} showAudience={showAudience} />
      <div className="timeline">
        {loading ? (
          <div className="muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">No activity yet — log your first touch above.</div>
        ) : (
          items.map(a => <ActivityRow key={a.id} a={a} users={users} />)
        )}
      </div>
    </div>
  )
}

function ActivityRow({ a, users }) {
  const m = TYPE_META[a.type] || { icon: '•', label: a.type }
  const aud = a.metadata?.audience
  const when = new Date(a.created_at)
  return (
    <div className="tl-item">
      <div className="tl-icon" aria-hidden>{m.icon}</div>
      <div className="tl-main">
        <div className="tl-head">
          <span className="tl-type">{m.label}</span>
          {aud === 'manufacturer' && <span className="tl-aud factory">Factory</span>}
          {aud === 'client' && <span className="tl-aud">Client</span>}
          <span className="tl-when">
            {when.toLocaleDateString()} · {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        {a.body && <div className="tl-body">{a.body}</div>}
        <div className="tl-by muted">{userLabel(users, a.created_by) || 'System'}</div>
      </div>
    </div>
  )
}
