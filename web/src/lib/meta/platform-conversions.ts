import { after } from 'next/server'
import type Stripe from 'stripe'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { patients, tenants, tenantUsers, users } from '@/db/schema'
import { isTenantsFirst } from '@/db/queries/tenant-firsts'
import { getAppUrl } from '@/lib/app-url'
import { buildFbc } from '@/lib/marketing-attribution'
import { sendFirstPatientEvent, sendSubscribeEvent } from '@/lib/meta/events'
import { metaBrowserSignals } from '@/lib/meta/request-signals'
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

/**
 * FirstPatient for FloraClin's own dataset: the clinic started actually using
 * the product. Called by every path that creates a patient, right after the
 * insert. Every read runs inside after(), so patient creation never waits on
 * it, and nothing that fails here reaches the caller.
 *
 * Once per clinic without a column of its own: only the tenant's earliest
 * patient ever (soft-deleted rows included) fires, and the event id is fixed
 * per tenant so Meta drops the rare duplicate two concurrent first inserts
 * can still produce.
 */
export function scheduleFirstPatientConversion(
  actor: { tenantId: string; isPlatformAdmin: boolean },
  patientId: string,
  requestHeaders?: Pick<Headers, 'get'>,
): void {
  // Support work inside a customer's clinic is not the clinic activating.
  // The patient still counts as the first, as it does for analytics.
  if (actor.isPlatformAdmin) return
  const { tenantId } = actor
  try {
    const { clientIp, userAgent } = requestHeaders ? metaBrowserSignals(requestHeaders, () => undefined) : {}
    after(async () => {
      try {
        if (!(await isTenantsFirst(patients, tenantId, patientId))) return
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
        const signup = (tenant.signupAttribution ?? {}) as SignupIds
        // Only a clinic that was itself a signup conversion gets the
        // activation event, and the signup's metaEventId is the mark of one:
        // both self-signup paths (e-mail and Google) store it, while a clinic
        // a platform admin creates gets none (createClinicForOAuthUser skips
        // it, the admin panel writes no signup attribution at all). Older
        // clinics have one only if their signup recorded it then, which from
        // #52 to #122 meant accepting marketing tracking; the rest are left
        // out rather than measured on a basis they never saw.
        if (!signup.metaEventId) return
        const email = await ownerEmail(tenantId)
        if (!email) return
        await sendFirstPatientEvent({
          eventId: `first_patient:${tenantId}`,
          email,
          phone: tenant.phone,
          eventSourceUrl: `${getAppUrl()}/pacientes`,
          clientIp,
          userAgent,
          fbc: signup.fbc ?? signupFbc(signup),
          fbp: signup.fbp,
        })
      } catch (error) {
        reportSideEffectFailure(error, { area: 'meta-capi', step: 'first_patient', extra: { tenantId } })
      }
    })
  } catch (error) {
    // after() outside a request scope (a script, a test).
    reportSideEffectFailure(error, { area: 'meta-capi', step: 'first_patient', extra: { tenantId } })
  }
}

async function ownerEmail(tenantId: string): Promise<string | null> {
  const [owner] = await db
    .select({ email: users.email })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.role, 'owner'), eq(tenantUsers.isActive, true)))
    .orderBy(asc(tenantUsers.createdAt))
    .limit(1)
  return owner?.email || null
}

type SignupIds = { fbc?: string; fbp?: string; fbclid?: string; capturedAt?: string; metaEventId?: string }

function signupFbc({ fbclid, capturedAt }: SignupIds): string | undefined {
  return fbclid && capturedAt ? buildFbc(fbclid, Date.parse(capturedAt)) : undefined
}
