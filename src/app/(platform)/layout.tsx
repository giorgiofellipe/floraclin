import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { getAuthContext, getUserTenants } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext()

  const [[tenant], userTenants] = await Promise.all([
    db
      .select({ name: tenants.name, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1),
    getUserTenants(auth.userId),
  ])

  // Enforce onboarding completion before accessing platform
  const settings = (tenant?.settings as Record<string, unknown>) ?? {}
  if (!settings.onboarding_completed) {
    redirect('/onboarding')
  }

  // Build tenant options for switcher (only relevant if user has >1 tenant)
  const tenantOptions = userTenants.map((t) => ({
    tenantId: t.tenantId,
    tenantName: t.tenantName,
  }))

  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <Sidebar
        clinicName={tenant?.name ?? 'FloraClin'}
        userName={auth.fullName}
        userRole="HOF"
        tenants={tenantOptions}
        activeTenantId={auth.tenantId}
      />
      <div className="md:pl-[200px]">
        <Header
          userName={auth.fullName}
          userEmail={auth.email}
          clinicName={tenant?.name ?? 'FloraClin'}
          tenants={tenantOptions}
          activeTenantId={auth.tenantId}
        />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
