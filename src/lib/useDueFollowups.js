// useDueFollowups: the same "due today or overdue, pre-order, non-dead" set the
// Today page shows — exposed as a live count for the nav badge, tab title, and
// desktop reminders. Updates in realtime as clients change.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isoToday } from './followups'
import { DEAD_STATUSES } from './constants'

export function useDueFollowups() {
  const [clients, setClients] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const today = isoToday()
      const { data } = await supabase
        .from('clients')
        .select('id, name, follow_up_date, status')
        .not('follow_up_date', 'is', null)
        .lte('follow_up_date', today)
      if (cancelled) return
      const due = (data ?? [])
        .filter(c => !DEAD_STATUSES.includes(c.status) && c.status !== 'ordered')
        .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
      setClients(due)
    }
    load()
    const ch = supabase
      .channel('due-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [])

  return { count: clients.length, clients }
}
