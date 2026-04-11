import { createClient } from '@supabase/supabase-js'

// Guard: this module uses the service role key and must never run in the browser
if (typeof window !== 'undefined') {
  throw new Error('storage-client must only be imported on the server')
}

// Standalone Supabase client for Storage only (no auth dependency)
// Uses service role key for server-side file operations
export function createStorageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
