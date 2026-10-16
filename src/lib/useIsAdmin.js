// useIsAdmin: is the signed-in login an admin (users.role = 'admin')? The Performance page is for the
// owner and Joshua only (owner 10/16/26); their two logins are made admins with one line of SQL in
// the Supabase SQL editor. Reps do not see the menu item or the page.
// This hides the screen; it is not a lock on the data (every signed-in login can read the CRM's rows).

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'

const cache = new Map() // user id -> true / false

export function useIsAdmin() {
  const { user } = useAuth()
  const id = user?.id || null
  const [admin, setAdmin] = useState(id && cache.has(id) ? cache.get(id) : null) // null = still checking
  useEffect(() => {
    if (!id) { setAdmin(false); return undefined }
    if (cache.has(id)) { setAdmin(cache.get(id)); return undefined }
    let alive = true
    supabase.from('users').select('role').eq('id', id).maybeSingle().then(({ data, error }) => {
      const yes = !error && data?.role === 'admin'
      if (!error) cache.set(id, yes)
      if (alive) setAdmin(yes)
    })
    return () => { alive = false }
  }, [id])
  return admin
}
