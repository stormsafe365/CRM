// useDesignPings: a customer just sent a design from their design link (owner
// 10/16/26) → a toast in the CRM, plus a desktop notification when the rep has
// notifications on (the same permission as the follow-up reminders). Clicking
// the notification opens the lead (or Customer Designs, for a design not on a lead yet).
// Large rows can arrive trimmed over realtime, so the row is read back by id.
// Subscribed once for the whole session (navigate lives in a ref: react-router
// hands out a new navigate on every page change). At most one desktop
// notification per 15 s, so a burst of sends is one ping, not a storm.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { toast } from './uiFx'
import { escHtml } from './designLinks'

const NOTIFY_GAP_MS = 15000

export function useDesignPings() {
  const navigate = useNavigate()
  const navRef = useRef(navigate)
  navRef.current = navigate
  useEffect(() => {
    let alive = true
    let lastNote = 0
    let pending = 0
    let latest = null // the newest design row: { name, client_id }
    let timer = null
    const flush = () => {
      timer = null
      if (!alive || !pending) return
      const n = pending
      const r = latest || {}
      pending = 0
      lastNote = Date.now()
      const who = r.name || 'a customer'
      toast(n > 1 ? `${n} new customer designs` : `New customer design from ${escHtml(who)}`, 'success')
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const note = new Notification('New customer design', { body: n > 1 ? `${n} designs came in from design links.` : `${who} sent a design from their design link.`, icon: '/logo.png' })
          note.onclick = () => { window.focus(); navRef.current(n === 1 && r.client_id ? `/clients/${r.client_id}` : '/designs'); note.close() }
        }
      } catch { /* notifications are optional */ }
    }
    const ch = supabase
      .channel('designs-ping')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'design_requests' }, async (p) => {
        let r = p?.new || {}
        if (r.id && (!r.name || r.client_id === undefined)) {
          const { data } = await supabase.from('design_requests').select('id, name, client_id').eq('id', r.id).maybeSingle()
          if (data) r = data
        }
        if (!alive) return
        pending++
        latest = r
        if (timer) return // already waiting: this one joins that ping
        const wait = NOTIFY_GAP_MS - (Date.now() - lastNote)
        if (wait <= 0) flush()
        else timer = setTimeout(flush, wait)
      })
      .subscribe()
    return () => { alive = false; if (timer) clearTimeout(timer); supabase.removeChannel(ch) }
  }, [])
}
