import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
  )
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
  },
})
