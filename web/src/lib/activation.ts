import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  appointments,
  patients,
  procedureRecords,
  tenants,
  tenantSubscriptions,
  whatsappMessages,
} from '@/db/schema'
import type { SubscriptionStatus } from '@/db/queries/subscriptions'
import { brCalendarDaysBetween } from '@/lib/dates'

export interface ActivationState {
  onboardingDone: boolean
  hasPatient: boolean
  hasAppointment: boolean
  hasProcedureRecord: boolean
  hasWhatsappSend: boolean
  trialDay: number
  daysLeft: number
  subscriptionStatus: SubscriptionStatus
  subscriptionSource: string
  optedOut: boolean
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
      hasPatient: sql<boolean>`exists (select 1 from ${patients} where ${patients.tenantId} = ${tenants.id})`,
      hasAppointment: sql<boolean>`exists (select 1 from ${appointments} where ${appointments.tenantId} = ${tenants.id})`,
      hasProcedureRecord: sql<boolean>`exists (select 1 from ${procedureRecords} where ${procedureRecords.tenantId} = ${tenants.id})`,
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
    subscriptionStatus: row.status as SubscriptionStatus,
    subscriptionSource: row.source,
    optedOut: row.optedOutAt != null,
  }
}
