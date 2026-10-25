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
): void {
  const email = session.customer_details?.email ?? session.customer_email
  if (!email) return
  after(async () => {
    try {
      const [tenant] = await db
        .select({
          phone: tenants.phone,
          signupAttribution: tenants.signupAttribution,
          optedOutAt: tenants.metaConversionsOptedOutAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
      if (tenant?.optedOutAt) return
      await sendSubscribeEvent({
        eventId: `subscribe:${session.id}`,
        email,
        phone: tenant?.phone,
        eventSourceUrl: `${getAppUrl()}/configuracoes?tab=assinatura`,
        fbc: signupFbc(tenant?.signupAttribution),
        valueCents: plan.priceCents,
        planSlug: plan.slug,
      })
    } catch (error) {
      reportSideEffectFailure(error, { area: 'meta-capi', step: 'schedule_subscribe', extra: { tenantId } })
    }
  })
}

function signupFbc(attribution: unknown): string | undefined {
  const { fbc, fbclid, capturedAt } = (attribution ?? {}) as { fbc?: string; fbclid?: string; capturedAt?: string }
  if (fbc) return fbc
  return fbclid ? buildFbc(fbclid, capturedAt ? Date.parse(capturedAt) : undefined) : undefined
}
