import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth, signOut } from '@/lib/auth-config'
import { signedInBeforePasswordChange } from '@/lib/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'

// Re-checks before signing out, so a cross-site link cannot log a user out.
export async function GET() {
  const session = await auth()
  if (session?.user?.id) {
    const [user] = await db
      .select({ passwordChangedAt: users.passwordChangedAt })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
    if (signedInBeforePasswordChange((session as { authAt?: number }).authAt, user?.passwordChangedAt ?? null)) {
      await signOut({ redirectTo: '/login' })
    }
  }
  redirect('/login')
}
