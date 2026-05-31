// Loads all rows from public.users. Used for "primary rep" dropdowns
// across the app. Cached in module scope so it only fetches once per
// page load — users list rarely changes.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

let cache = null
let cachePromise = null

async function loadUsers() {
  if (cache) return cache
  if (cachePromise) return cachePromise
  cachePromise = supabase
    .from('users')
    .select('id, display_name, email')
    .order('display_name')
    .then(({ data, error }) => {
      if (error) throw error
      cache = data ?? []
      return cache
    })
  return cachePromise
}

export function useUsers() {
  const [users, setUsers] = useState(cache ?? [])
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (cache) return
    let cancelled = false
    loadUsers()
      .then(data => { if (!cancelled) { setUsers(data); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return { users, loading, error }
}

// Helper to look up display_name by id, falling back to email or '—'.
export function userLabel(users, id) {
  if (!id) return '—'
  const u = users.find(x => x.id === id)
  return u?.display_name ?? u?.email ?? '—'
}
