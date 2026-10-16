// useIsAdmin: is the signed-in login an admin (users.role = 'admin')? The Performance page is for the
// owner and Joshua only (owner 10/16/26); their two logins are made admins with one line of SQL in
// the Supabase SQL editor. Reps do not see the menu item or the page.
// This hides the screen; it is not a lock on the data (every signed-in login can read the CRM's rows).
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
