import { db } from '@/db/client'
import {
  appointments,
  patients,
  procedureTypes,
  procedureRecords,
  financialEntries,
  installments,
  auditLogs,
  users,
} from '@/db/schema'
import { eq, and, ne, isNull, gte, lte, sql, desc, count, sum } from 'drizzle-orm'
import {
  startOfWeek,
  endOfWeek,
  addDays,
  format,
} from 'date-fns'
import { brToday, startOfBrDay, endOfBrDay } from '@/lib/dates'
import { getRevenueOverview } from './financial'

// ─── Month resolution ──────────────────────────────────────────────

/** Strict `YYYY-MM` matcher, month clamped to 01-12. Shared with the API route. */
export const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the following month is the last day of this month. Using
  // Date.UTC + getUTCDate keeps this pure calendar arithmetic, independent
  // of the host's timezone (no string parsing, no local/UTC ambiguity).
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

interface MonthBoundaries {
  monthStartYmd: string
  monthEndYmd: string
  isCurrentMonth: boolean
}

/**
 * Resolve an optional `YYYY-MM` month into BR-calendar day boundaries.
 * Defaults to the current BR month (via `brToday`, not host-local `Date`)
 * when omitted. Throws on malformed input or a month in the future, since
 * both should have been rejected by the API route before reaching here.
 */
export function resolveMonthBoundaries(month?: string): MonthBoundaries {
  const currentMonth = brToday().slice(0, 7)
  const targetMonth = month ?? currentMonth

  if (!MONTH_PARAM_RE.test(targetMonth)) {
    throw new Error(`getQuickStats: month must be in YYYY-MM format, got "${targetMonth}"`)
  }
  if (targetMonth > currentMonth) {
    throw new Error(`getQuickStats: month "${targetMonth}" is in the future`)
  }

  const [yearStr, monthStr] = targetMonth.split('-')
  const lastDay = daysInMonth(Number(yearStr), Number(monthStr))

  return {
    monthStartYmd: `${targetMonth}-01`,
    monthEndYmd: `${targetMonth}-${String(lastDay).padStart(2, '0')}`,
    isCurrentMonth: targetMonth === currentMonth,
  }
}

// ─── Types ──────────────────────────────────────────────────────────

export interface TodayAppointment {
  id: string
  patientId: string | null
  patientName: string | null
  bookingName: string | null
  bookingPhone: string | null
  procedureTypeName: string | null
  startTime: string
  endTime: string
  status: string
}

export interface QuickStats {
  // Distinct patients seen this week. Only meaningful for the current
  // month: null when a past month is selected (see getQuickStats).
  patientsThisWeek: number | null
  proceduresThisMonth: number
  revenueThisMonth: number | null
  // Same practitioner-visibility rule as revenueThisMonth: null for
  // practitioners, since these are clinic-wide financial figures they
  // must not see. Scoped to the selected month via getRevenueOverview.
  totalPending: number | null
  totalExpenses: number | null
  totalOverdue: number | null
}

export interface UpcomingFollowUp {
  id: string
  patientId: string
  patientName: string
  procedureTypeName: string
  followUpDate: string
}

export interface RecentActivityEntry {
  id: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string | null
  createdAt: Date
}

// ─── Queries ────────────────────────────────────────────────────────

export async function getTodayAppointments(
  tenantId: string,
  practitionerId?: string
): Promise<TodayAppointment[]> {
  const today = brToday()

  const conditions = [
    eq(appointments.tenantId, tenantId),
    eq(appointments.date, today),
    isNull(appointments.deletedAt),
  ]

  if (practitionerId) {
    conditions.push(eq(appointments.practitionerId, practitionerId))
  }

  const result = await db
    .select({
      id: appointments.id,
      patientId: appointments.patientId,
      patientName: patients.fullName,
      bookingName: appointments.bookingName,
      bookingPhone: appointments.bookingPhone,
      procedureTypeName: procedureTypes.name,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(
      procedureTypes,
      eq(appointments.procedureTypeId, procedureTypes.id)
    )
    .where(and(...conditions))
    .orderBy(appointments.startTime)

  return result
}

export async function getQuickStats(
  tenantId: string,
  practitionerId?: string,
  month?: string
): Promise<QuickStats> {
  const { monthStartYmd, monthEndYmd, isCurrentMonth } = resolveMonthBoundaries(month)
  const monthStart = startOfBrDay(monthStartYmd)
  const monthEnd = endOfBrDay(monthEndYmd)

  // Patients this week (distinct patients with appointments this week).
  // This is only computed for the current month: "this week" has no
  // sensible meaning next to a historical month's procedures/revenue, so
  // showing last computed week's count there would be a misleading
  // mixed-period figure. We return null instead (same "not applicable"
  // convention already used by revenueThisMonth for practitioners) rather
  // than renaming the field, since no dashboard card currently renders it.
  let patientsThisWeek: number | null = null
  if (isCurrentMonth) {
    const now = new Date()
    const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const patientsConditions = [
      eq(appointments.tenantId, tenantId),
      isNull(appointments.deletedAt),
      gte(appointments.date, weekStart),
      lte(appointments.date, weekEnd),
    ]
    if (practitionerId) {
      patientsConditions.push(
        eq(appointments.practitionerId, practitionerId)
      )
    }

    const patientsResult = await db
      .select({
        total: sql<number>`count(distinct ${appointments.patientId})`,
      })
      .from(appointments)
      .where(and(...patientsConditions))

    patientsThisWeek = Number(patientsResult[0]?.total ?? 0)
  }

  // Procedures this month (selected month)
  const proceduresConditions = [
    eq(procedureRecords.tenantId, tenantId),
    isNull(procedureRecords.deletedAt),
    gte(procedureRecords.performedAt, monthStart),
    lte(procedureRecords.performedAt, monthEnd),
  ]
  if (practitionerId) {
    proceduresConditions.push(
      eq(procedureRecords.practitionerId, practitionerId)
    )
  }

  const proceduresResult = await db
    .select({ total: count() })
    .from(procedureRecords)
    .where(and(...proceduresConditions))

  // Revenue this month (selected month) - only for clinic-wide view (not
  // for practitioners). Practitioners should not see clinic-wide revenue.
  let revenueThisMonth: number | null = null
  let totalPending: number | null = null
  let totalExpenses: number | null = null
  let totalOverdue: number | null = null
  if (!practitionerId) {
    const revenueConditions = [
      eq(installments.tenantId, tenantId),
      eq(installments.status, 'paid'),
      gte(installments.paidAt, monthStart),
      lte(installments.paidAt, monthEnd),
    ]

    const revenueResult = await db
      .select({
        total: sum(installments.amount),
      })
      .from(installments)
      .where(and(...revenueConditions))

    revenueThisMonth = Number(revenueResult[0]?.total ?? 0)

    // Reuse getRevenueOverview (same query the Financeiro screen uses) for
    // pending/expenses/overdue instead of duplicating that SQL here. Scoped
    // to the same monthStartYmd/monthEndYmd resolved above, so the dashboard
    // card and the Financeiro screen can never drift on month boundaries.
    const revenueOverview = await getRevenueOverview(tenantId, monthStartYmd, monthEndYmd)
    // Defensive Number(...): pg's driver can return numeric columns as
    // strings, and getRevenueOverview's summary spreads the raw query
    // row through without normalizing these two fields.
    totalPending = Number(revenueOverview.summary.totalPending)
    totalExpenses = Number(revenueOverview.summary.totalExpenses)
    totalOverdue = Number(revenueOverview.summary.totalOverdue)
  }

  return {
    patientsThisWeek,
    proceduresThisMonth: Number(proceduresResult[0]?.total ?? 0),
    revenueThisMonth,
    totalPending,
    totalExpenses,
    totalOverdue,
  }
}

export async function getUpcomingFollowUps(
  tenantId: string,
  practitionerId?: string
): Promise<UpcomingFollowUp[]> {
  const today = brToday()
  const twoWeeksOut = format(addDays(new Date(), 14), 'yyyy-MM-dd')

  const conditions = [
    eq(procedureRecords.tenantId, tenantId),
    isNull(procedureRecords.deletedAt),
    gte(procedureRecords.followUpDate, today),
    lte(procedureRecords.followUpDate, twoWeeksOut),
  ]

  if (practitionerId) {
    conditions.push(eq(procedureRecords.practitionerId, practitionerId))
  }

  try {
    const result = await db
      .select({
        id: procedureRecords.id,
        patientId: procedureRecords.patientId,
        patientName: patients.fullName,
        procedureTypeName: procedureTypes.name,
        followUpDate: procedureRecords.followUpDate,
      })
      .from(procedureRecords)
      .innerJoin(patients, eq(procedureRecords.patientId, patients.id))
      .innerJoin(
        procedureTypes,
        eq(procedureRecords.procedureTypeId, procedureTypes.id)
      )
      .where(and(...conditions))
      .orderBy(procedureRecords.followUpDate)

    return result as UpcomingFollowUp[]
  } catch {
    return []
  }
}

export async function getRecentActivity(
  tenantId: string,
  limit: number = 10
): Promise<RecentActivityEntry[]> {
  const result = await db
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      userName: users.fullName,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.userId, users.id))
    .where(and(eq(auditLogs.tenantId, tenantId), ne(auditLogs.entityType, 'impersonation')))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)

  return result
}
