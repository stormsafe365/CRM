// useDesignPings: a customer just sent a design from their design link (owner
// 10/16/26) → a toast in the CRM, plus a desktop notification when the rep has
// notifications on (the same permission as the follow-up reminders). Clicking
// the notification opens the lead (or Leads, for a design not on a lead yet).
// Large rows can arrive trimmed over realtime, so the row is read back by id.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { toast } from './uiFx'
import { escHtml } from './designLinks'

export function useDesignPings() {
  const navigate = useNavigate()
  useEffect(() => {
    let alive = true
    const ch = supabase
      .channel('designs-ping')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'design_requests' }, async (p) => {
        let r = p?.new || {}
        if (r.id && (!r.name || r.client_id === undefined)) {
          const { data } = await supabase.from('design_requests').select('id, name, client_id').eq('id', r.id).maybeSingle()
          if (data) r = data
        }
        if (!alive) return
        const who = r.name || 'a customer'
        toast(`New customer design from ${escHtml(who)}`, 'success')
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification('New customer design', { body: `${who} sent a design from their design link.`, icon: '/logo.png' })
            n.onclick = () => { window.focus(); navigate(r.client_id ? `/clients/${r.client_id}` : '/clients'); n.close() }
          }
        } catch { /* notifications are optional */ }
      })
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [navigate])
}
