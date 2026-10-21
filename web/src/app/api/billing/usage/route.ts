import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { effectiveSubscriptionStatus } from '@/lib/subscription-access'
import { db } from '@/db/client'
import { tenantUsers, patients } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'
import { handleApiError } from '@/lib/api-error'
import { getSubscriptionDiscount } from '@/lib/stripe'

type PlanLimits = Record<string, number>

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    const subscription = await getSubscription(ctx.tenantId)
    if (!subscription) {
      return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
    }

    const limits = (subscription.plan.limits ?? {}) as PlanLimits

    const [usersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.tenantId, ctx.tenantId),
          eq(tenantUsers.isActive, true)
        )
      )

    const [patientsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, ctx.tenantId),
          isNull(patients.deletedAt)
        )
      )

    const status = effectiveSubscriptionStatus(subscription) ?? subscription.status
    // A coupon on the Stripe subscription (the win-back offer): the page shows
    // what the clinic actually pays and until when. Only for a live Stripe
    // subscription; cached in getSubscriptionDiscount.
    const discountP =
      subscription.source === 'stripe' &&
      subscription.stripeSubscriptionId &&
      (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled')
        ? getSubscriptionDiscount(subscription.stripeSubscriptionId, new Date(), subscription.planId)
        : Promise.resolve(null)
    const [whatsappUsage, discount] = await Promise.all([getCreditUsage(ctx.tenantId), discountP])

    return NextResponse.json({
      subscription: {
        // The effective status, so this page agrees with the gate: a trial
        // or gift past its end reads `expired` even before the 00:00 BRT
        // cron rewrites the row, and can buy its current plan again.
        status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        // Drives the billing-portal link. A lapsed tenant still has a
        // customer record, and their invoices are in it.
        hasStripeCustomer: Boolean(subscription.stripeCustomerId),
        source: subscription.source,
      },
      plan: {
        name: subscription.plan.name,
        slug: subscription.plan.slug,
        priceCents: subscription.plan.priceCents,
        features: subscription.plan.features,
      },
      discount,
      usage: {
        users: {
          used: usersRow?.count ?? 0,
          limit: limits.users ?? 0,
        },
        patients: {
          used: patientsRow?.count ?? 0,
          limit: limits.patients ?? 0,
        },
        whatsapp: {
          used: whatsappUsage.used,
          limit: whatsappUsage.total,
          periodEnd: whatsappUsage.periodEnd.toISOString(),
        },
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
