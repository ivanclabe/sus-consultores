import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configuracionCompleta = Boolean(url && anon)

export const supabase = createClient(url ?? 'http://localhost', anon ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true },
})
