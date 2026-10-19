// useIsAdmin: is the signed-in login an admin (users.role = 'admin')? Admins (the owner and Joshua) see
// the whole business; a sales rep (owner 10/18/26: Lauren) gets "My stats", no Trash, no Delete Lead,
// and cannot change who a lead is assigned to. This only shapes the screens: the LOCK on the data is
// migration 023 (row security), which gives a rep only her own leads whatever the app asks for.
//
// true / false / null (still checking) / 'error' (could not check - the page says so, never "not admin").
// Only a YES is remembered: a login made admin after the app opened gets the page on the next check
// (e.g. opening Performance again), with no restart.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'

const admins = new Set() // user ids confirmed admin this session

export function useIsAdmin(recheck = 0) {
  const { user } = useAuth()
  const id = user?.id || null
  const [state, setState] = useState(id && admins.has(id) ? true : null)
  useEffect(() => {
    if (!id) { setState(false); return undefined }
    if (admins.has(id)) { setState(true); return undefined }
    let alive = true
    setState(null)
    supabase.from('users').select('role').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (!alive) return
      if (error) { setState('error'); return }
      const yes = data?.role === 'admin'
      if (yes) admins.add(id)
      setState(yes)
    })
    return () => { alive = false }
  }, [id, recheck])
  return state
}
