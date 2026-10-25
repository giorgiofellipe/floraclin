import { after } from 'next/server'
import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getAppUrl } from '@/lib/app-url'
import { buildFbc } from '@/lib/marketing-attribution'
import { sendSubscribeEvent } from '@/lib/meta/events'
import { reportSideEffectFailure } from '@/lib/observability'

/**
 * Subscribe for FloraClin's own dataset, sent from the server so Meta sees
 * every paid conversion, not only the ones the browser pixel caught. The event
 * id is the one the billing page gives the pixel, so Meta counts it once.
 */
export function scheduleSubscribeConversion(
  session: Stripe.Checkout.Session,
  tenantId: string,
  plan: { slug: string; priceCents: number },
  paidAt: Date,
): void {
  const email = session.customer_details?.email ?? session.customer_email
  // Test-mode checkouts (Stripe CLI, previews) must not reach the production dataset.
  if (!email || !session.livemode) return
  after(async () => {
    try {
      const [tenant] = await db
        .select({
          phone: tenants.phone,
          signupAttribution: tenants.signupAttribution,
          optedOutAt: tenants.metaConversionsOptedOutAt,
          deletedAt: tenants.deletedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
      if (!tenant || tenant.optedOutAt || tenant.deletedAt) return
      const browser = session.metadata ?? {}
      const signup = (tenant.signupAttribution ?? {}) as SignupIds
      await sendSubscribeEvent({
        eventId: `subscribe:${session.id}`,
        eventTime: paidAt,
        email,
        phone: tenant.phone,
        eventSourceUrl: `${getAppUrl()}/configuracoes?tab=assinatura`,
        clientIp: browser.meta_ip,
        userAgent: browser.meta_ua,
        fbc: browser.meta_fbc ?? signup.fbc ?? signupFbc(signup),
        fbp: browser.meta_fbp ?? signup.fbp,
        paidCents: session.amount_total ?? plan.priceCents,
        listPriceCents: plan.priceCents,
        planSlug: plan.slug,
      })
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'schedule_subscribe', extra: { tenantId } })
    }
  })
}

type SignupIds = { fbc?: string; fbp?: string; fbclid?: string; capturedAt?: string }

function signupFbc({ fbclid, capturedAt }: SignupIds): string | undefined {
  return fbclid && capturedAt ? buildFbc(fbclid, Date.parse(capturedAt)) : undefined
}
