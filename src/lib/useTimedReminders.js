// useTimedReminders: while the CRM is open, pop a desktop/browser notification
// at each follow-up's scheduled TIME today (the follow_up_time we added in
// migration 008). This is "app is open" coverage — it complements, doesn't
// replace, the daily email (which covers closed-app). Requires the rep to have
// granted notification permission (the bell in AppLayout).
//
// Date-based "due" is unchanged; this only adds a clock-triggered ping for
// follow-ups that have a specific time set for today.

import { useEffect } from 'react'
import { supabase } from './supabase'
import { isoToday, fmtTime } from './followups'
import { DEAD_STATUSES } from './constants'

export function useTimedReminders(enabled, onFire) {
  useEffect(() => {
    if (!enabled) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    let cancelled = false
    let timers = []
    const clearTimers = () => { timers.forEach(clearTimeout); timers = [] }

    async function schedule() {
      clearTimers()
      const today = isoToday()
      const { data } = await supabase
        .from('clients')
        .select('id, name, follow_up_date, follow_up_time, status, deleted_at')
        .eq('follow_up_date', today)
        .not('follow_up_time', 'is', null)
      if (cancelled || !data) return

      const now = Date.now()
      for (const c of data) {
        if (c.deleted_at || DEAD_STATUSES.includes(c.status) || c.status === 'ordered') continue
        const [h, m] = c.follow_up_time.split(':').map(Number)
        const when = new Date(); when.setHours(h, m, 0, 0)
        const delay = when.getTime() - now
        // Only schedule times still ahead of us today.
        if (delay <= 0 || delay > 24 * 3600 * 1000) continue

        // Fire once per client/time/day — survives reloads via localStorage.
        const fireKey = `ss_fired:${c.id}:${today}:${c.follow_up_time}`
        if (localStorage.getItem(fireKey)) continue

        timers.push(setTimeout(() => {
          try {
            const note = new Notification(`Follow-up: ${c.name}`, {
              body: `Scheduled for ${fmtTime(c.follow_up_time)} today`,
              icon: '/logo.png',
              tag: fireKey,
            })
            note.onclick = () => { window.focus(); window.location.assign(`/clients/${c.id}`); note.close() }
          } catch { /* notification can fail silently if perms changed */ }
          try { localStorage.setItem(fireKey, '1') } catch { /* private mode */ }
          onFire?.(c)
        }, delay))
      }
    }

    schedule()
    // Reschedule whenever a follow-up changes (date/time edited, marked done…).
    const ch = supabase
      .channel('timed-reminders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => schedule())
      .subscribe()

    return () => { cancelled = true; clearTimers(); supabase.removeChannel(ch) }
  }, [enabled, onFire])
}
