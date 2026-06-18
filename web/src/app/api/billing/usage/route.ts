import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getSubscription } from '@/db/queries/subscriptions'
import { db } from '@/db/client'
import { tenantUsers, patients } from '@/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getCreditUsage } from '@/db/queries/whatsapp-credits'

type PlanLimits = Record<string, number>

export async function GET() {
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

    const whatsappUsage = await getCreditUsage(ctx.tenantId)

    return NextResponse.json({
      subscription: {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        source: subscription.source,
      },
      plan: {
        name: subscription.plan.name,
        slug: subscription.plan.slug,
        priceCents: subscription.plan.priceCents,
        features: subscription.plan.features,
      },
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Billing usage error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
