import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { CookiePreferencesLink } from '@/components/marketing/cookie-consent-banner'
import { SubscriptionBanner } from '@/components/layout/subscription-banner'
import { InstallBanner } from '@/components/layout/install-banner'
import { PlatformFooter } from '@/components/layout/platform-chrome'
import Link from 'next/link'
import { getAuthContext, getUserTenants } from '@/lib/auth'
import { getSubscription, listPlans } from '@/db/queries/subscriptions'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { effectiveSubscriptionStatus, isSubscriptionRowActive } from '@/lib/subscription-access'
import { getWinbackOffer, publicWinbackOffer } from '@/lib/winback'
import { SubscriptionAccessProvider, type PaywallPlan } from '@/components/layout/subscription-access'
import { ExpiredPaywall } from '@/components/layout/expired-paywall'

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

  // Read-only mode mirrors the server gate exactly (same rule, same
  // platform-admin exemption), so the UI never disables something the API
  // would allow, or the reverse.
  const now = new Date()
  const readOnly = !auth.isPlatformAdmin && !isSubscriptionRowActive(subscription, now)
  const displayStatus = effectiveSubscriptionStatus(subscription, now)
  const paywallPlans: PaywallPlan[] = readOnly
    ? (await listPlans(true))
        .filter((p) => p.priceCents > 0 && !!p.stripePriceId)
        .map((p) => ({ slug: p.slug, name: p.name, priceCents: p.priceCents, billingInterval: p.billingInterval }))
    : []
  const winback = readOnly ? publicWinbackOffer(getWinbackOffer(subscription, now)) : null

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
    <SubscriptionAccessProvider
      readOnly={readOnly}
      reason={readOnly ? (subscription?.source === 'trial' ? 'trial' : 'subscription') : null}
      tenantId={auth.tenantId}
      canSubscribe={auth.role === 'owner'}
      plans={paywallPlans}
      winback={winback}
    >
    <div className="min-h-screen bg-[#F4F6F8]">
      <Sidebar
        clinicName={tenant?.name ?? 'FloraClin'}
        userName={auth.fullName}
        userRole={auth.role}
        tenants={tenantOptions}
        activeTenantId={auth.tenantId}
        isPlatformAdmin={auth.isPlatformAdmin}
        impersonatingTenantName={impersonatingTenantName}
        whatsappEnabled={isWhatsAppEnabled(settings)}
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
          whatsappEnabled={isWhatsAppEnabled(settings)}
        />
        <SubscriptionBanner
          subscriptionStatus={displayStatus}
          currentPeriodEnd={subscription?.currentPeriodEnd?.toISOString() ?? null}
          subscriptionSource={subscription?.source ?? null}
        />
        <InstallBanner />
        <main className="flex-1 p-4 md:p-6">{children}</main>
        <PlatformFooter>
          <Link href="https://floraclin.com.br/privacidade" className="hover:text-sage">
            Privacidade
          </Link>
          <span className="mx-2 text-mid/50">•</span>
          <CookiePreferencesLink className="hover:text-sage" />
        </PlatformFooter>
      </div>
      <ExpiredPaywall />
    </div>
    </SubscriptionAccessProvider>
  )
}
