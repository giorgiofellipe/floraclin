import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  appointments,
  patients,
  procedureRecords,
  tenantLifecycleMessages,
  tenants,
  tenantSubscriptions,
  whatsappMessages,
} from '@/db/schema'
import type { SubscriptionStatus } from '@/db/queries/subscriptions'
import { brCalendarDaysBetween } from '@/lib/dates'
import { MARKETING_MESSAGE_KEYS } from '@/lib/lifecycle-messages'

export interface ActivationState {
  onboardingDone: boolean
  hasPatient: boolean
  hasAppointment: boolean
  hasProcedureRecord: boolean
  hasWhatsappSend: boolean
  trialDay: number
  daysLeft: number
  /** Milliseconds until the period ends; negative once it has. */
  msLeft: number
  subscriptionStatus: SubscriptionStatus
  subscriptionSource: string
  optedOut: boolean
  /** When the last marketing message actually went out, for the spacing rule. */
  lastMarketingSentAt: Date | null
}

export async function getActivationState(
  tenantId: string,
  now: Date = new Date(),
): Promise<ActivationState | null> {
  const [row] = await db
    .select({
      settings: tenants.settings,
      optedOutAt: tenants.lifecycleOptedOutAt,
      status: tenantSubscriptions.status,
      source: tenantSubscriptions.source,
      currentPeriodStart: tenantSubscriptions.currentPeriodStart,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      // Soft-deleted rows do not count, matching the trial recap.
      hasPatient: sql<boolean>`exists (select 1 from ${patients} where ${patients.tenantId} = ${tenants.id} and ${patients.deletedAt} is null)`,
      hasAppointment: sql<boolean>`exists (select 1 from ${appointments} where ${appointments.tenantId} = ${tenants.id} and ${appointments.deletedAt} is null)`,
      hasProcedureRecord: sql<boolean>`exists (select 1 from ${procedureRecords} where ${procedureRecords.tenantId} = ${tenants.id} and ${procedureRecords.deletedAt} is null)`,
      lastMarketingSentAt: sql<Date | string | null>`(select max(coalesce(${tenantLifecycleMessages.completedAt}, ${tenantLifecycleMessages.claimedAt})) from ${tenantLifecycleMessages} where ${tenantLifecycleMessages.tenantId} = ${tenants.id} and ${tenantLifecycleMessages.status} = 'sent' and ${tenantLifecycleMessages.messageKey} in (${sql.join(
        MARKETING_MESSAGE_KEYS.map((k) => sql`${k}`),
        sql`, `,
      )}))`,
      hasWhatsappSend: sql<boolean>`exists (select 1 from ${whatsappMessages} where ${whatsappMessages.tenantId} = ${tenants.id} and ${whatsappMessages.direction} = 'outbound')`,
    })
    .from(tenants)
    .innerJoin(tenantSubscriptions, eq(tenantSubscriptions.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId))
    .limit(1)

  if (!row) return null

  const settings = (row.settings ?? {}) as Record<string, unknown>

  return {
    onboardingDone: settings.onboarding_completed === true,
    hasPatient: row.hasPatient,
    hasAppointment: row.hasAppointment,
    hasProcedureRecord: row.hasProcedureRecord,
    hasWhatsappSend: row.hasWhatsappSend,
    trialDay: brCalendarDaysBetween(row.currentPeriodStart, now),
    daysLeft: brCalendarDaysBetween(now, row.currentPeriodEnd),
    msLeft: row.currentPeriodEnd.getTime() - now.getTime(),
    subscriptionStatus: row.status as SubscriptionStatus,
    subscriptionSource: row.source,
    optedOut: row.optedOutAt != null,
    lastMarketingSentAt: row.lastMarketingSentAt ? new Date(row.lastMarketingSentAt) : null,
  }
}
