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
import { eq, and, isNull, gte, lte, sql, desc, count, sum } from 'drizzle-orm'
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  format,
} from 'date-fns'
import { brToday, startOfBrDay, endOfBrDay } from '@/lib/dates'

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
  patientsThisWeek: number
  proceduresThisMonth: number
  revenueThisMonth: number | null
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
  practitionerId?: string
): Promise<QuickStats> {
  const now = new Date()
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd')

  // Patients this week (distinct patients with appointments this week)
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

  // Procedures this month
  const proceduresConditions = [
    eq(procedureRecords.tenantId, tenantId),
    isNull(procedureRecords.deletedAt),
    gte(procedureRecords.performedAt, startOfBrDay(monthStart)),
    lte(procedureRecords.performedAt, endOfBrDay(monthEnd)),
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

  // Revenue this month - only for clinic-wide view (not for practitioners)
  // Practitioners should not see clinic-wide revenue data
  let revenueThisMonth: number | null = null
  if (!practitionerId) {
    const revenueConditions = [
      eq(installments.tenantId, tenantId),
      eq(installments.status, 'paid'),
      gte(installments.paidAt, startOfBrDay(monthStart)),
      lte(installments.paidAt, endOfBrDay(monthEnd)),
    ]

    const revenueResult = await db
      .select({
        total: sum(installments.amount),
      })
      .from(installments)
      .where(and(...revenueConditions))

    revenueThisMonth = Number(revenueResult[0]?.total ?? 0)
  }

  return {
    patientsThisWeek: Number(patientsResult[0]?.total ?? 0),
    proceduresThisMonth: Number(proceduresResult[0]?.total ?? 0),
    revenueThisMonth,
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
    .where(eq(auditLogs.tenantId, tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)

  return result
}
