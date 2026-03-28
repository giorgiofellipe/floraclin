import { createClient } from '@supabase/supabase-js'

// Service role client — NEVER expose to browser. Use only for:
// - Inviting users (auth.admin.inviteUserByEmail)
// - Creating auth users
// - Platform admin operations
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
