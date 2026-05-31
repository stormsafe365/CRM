// Supabase client singleton.
// Reads project URL and anon key from environment variables (Vite injects
// any var starting with VITE_ into the frontend at build time).
// Never hardcode credentials here — they live in .env.local (local dev)
// or Vercel environment variables (production).

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Make sure .env.local exists with ' +
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
