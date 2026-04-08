import { createClient } from '@supabase/supabase-js'

// Standalone Supabase client for Storage only (no auth dependency)
// Uses service role key for server-side file operations
export function createStorageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
