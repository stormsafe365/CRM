// useLeadSearch: the lead list for the design-link pickers (owner 10/16/26).
// The newest 1,000 leads load once (never the ones in Trash); typing 2+
// characters also asks the server for name / email matches across ALL leads.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { loadLeadsForPicker, pickerList, searchTerm } from './designLinks'

export function useLeadSearch(enabled, search) {
  const [base, setBase] = useState(null) // null = loading
  const [remote, setRemote] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadLeadsForPicker(supabase)
      .then((d) => { if (alive) setBase(d) })
      .catch((e) => { if (alive) { setErr(e.message || String(e)); setBase([]) } })
    return () => { alive = false }
  }, [enabled])

  useEffect(() => {
    const t = searchTerm(search)
    if (!enabled || t.length < 2) { setRemote([]); return }
    let alive = true
    const h = setTimeout(() => {
      loadLeadsForPicker(supabase, t).then((d) => { if (alive) setRemote(d) }).catch(() => { /* local matches still show */ })
    }, 250)
    return () => { alive = false; clearTimeout(h) }
  }, [enabled, search])

  const list = useMemo(() => pickerList(base, remote, search), [base, remote, search])
  return { leads: base, list, err }
}
