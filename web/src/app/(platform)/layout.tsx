import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { SubscriptionBanner } from '@/components/layout/subscription-banner'
import { getAuthContext, getUserTenants } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext()

  const [[tenant], userTenants, subscription] = await Promise.all([
    db
      .select({ name: tenants.name, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1),
    getUserTenants(auth.userId),
    getSubscription(auth.tenantId),
  ])

  // Enforce onboarding completion before accessing platform
  // Skip redirect for platform admins — they can access any tenant regardless of onboarding status
  const settings = (tenant?.settings as Record<string, unknown>) ?? {}
  if (!settings.onboarding_completed && !auth.isPlatformAdmin) {
    redirect('/onboarding')
  }

  // Build tenant options for switcher (only relevant if user has >1 tenant)
  const tenantOptions = userTenants.map((t) => ({
    tenantId: t.tenantId,
    tenantName: t.tenantName,
  }))

  // Detect impersonation: admin's active tenant differs from their own first membership
  let impersonatingTenantName: string | undefined
  if (auth.isPlatformAdmin && userTenants.length > 0) {
    const ownTenantIds = userTenants.map((t) => t.tenantId)
    if (!ownTenantIds.includes(auth.tenantId)) {
      impersonatingTenantName = tenant?.name ?? undefined
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6F8]">
      <Sidebar
        clinicName={tenant?.name ?? 'FloraClin'}
        userName={auth.fullName}
        userRole={auth.role}
        tenants={tenantOptions}
        activeTenantId={auth.tenantId}
        isPlatformAdmin={auth.isPlatformAdmin}
        impersonatingTenantName={impersonatingTenantName}
        whatsappEnabled={!!settings.whatsapp_enabled}
      />
      <div className="flex min-h-screen flex-col md:pl-[200px]">
        <Header
          userName={auth.fullName}
          userEmail={auth.email}
          userId={auth.userId}
          userRole={auth.role}
          clinicName={tenant?.name ?? 'FloraClin'}
          tenants={tenantOptions}
          activeTenantId={auth.tenantId}
          isPlatformAdmin={auth.isPlatformAdmin}
          impersonatingTenantName={impersonatingTenantName}
          whatsappEnabled={!!settings.whatsapp_enabled}
        />
        <SubscriptionBanner
          subscriptionStatus={subscription?.status ?? null}
          currentPeriodEnd={subscription?.currentPeriodEnd?.toISOString() ?? null}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
