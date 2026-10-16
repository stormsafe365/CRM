// useDesignCounts: the Customer Designs badge in the sidebar (new designs) and
// the "not on a lead" count. Live: reloads (debounced) on any design change.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { countDesigns } from './designLinks'

// realtime-js hands back the SAME channel for the same name, so every user of
// this hook (sidebar badge, Leads strip, the page) needs its own name.
let seq = 0

export function useDesignCounts() {
  const [counts, setCounts] = useState({ fresh: 0, waiting: 0 })
  useEffect(() => {
    let alive = true
    let t = null
    const load = async () => {
      const c = await countDesigns(supabase)
      if (alive) setCounts(c)
    }
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500) }
    load()
    const ch = supabase.channel(`designs-count-${++seq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_requests' }, soon)
      .subscribe()
    window.addEventListener('ss:designs-updated', soon)
    return () => { alive = false; clearTimeout(t); supabase.removeChannel(ch); window.removeEventListener('ss:designs-updated', soon) }
  }, [])
  return counts
}
