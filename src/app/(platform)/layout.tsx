import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext()

  const [tenant] = await db
    .select({ name: tenants.name, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)

  // Enforce onboarding completion before accessing platform
  const settings = (tenant?.settings as Record<string, unknown>) ?? {}
  if (!settings.onboarding_completed) {
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-cream">
      <Sidebar clinicName={tenant?.name ?? 'FloraClin'} />
      <div className="md:pl-64">
        <Header userName={auth.fullName} userEmail={auth.email} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
