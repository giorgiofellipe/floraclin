import { db } from '@/db/client'
import { appointments, patients, procedureTypes, users, tenants } from '@/db/schema'
import { eq, and, isNull, gte, lte, sql, or, ne } from 'drizzle-orm'
import type { AppointmentStatus, AppointmentSource } from '@/types'
import { DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { verifyTenantOwnership, verifyUserBelongsToTenant } from './helpers'

export interface AppointmentListFilters {
  practitionerId?: string
  dateFrom: string // 'YYYY-MM-DD'
  dateTo: string   // 'YYYY-MM-DD'
}

export interface AppointmentWithDetails {
  id: string
  tenantId: string
  patientId: string | null
  practitionerId: string
  procedureTypeId: string | null
  date: string
  startTime: string
  endTime: string
  status: string
  source: string
  bookingName: string | null
  bookingPhone: string | null
  bookingEmail: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  patientName: string | null
  practitionerName: string
  procedureTypeName: string | null
}

export interface TimeSlot {
  start: string // 'HH:mm'
  end: string   // 'HH:mm'
}

export async function listAppointments(
  tenantId: string,
  filters: AppointmentListFilters
): Promise<AppointmentWithDetails[]> {
  const conditions = [
    eq(appointments.tenantId, tenantId),
    isNull(appointments.deletedAt),
    gte(appointments.date, filters.dateFrom),
    lte(appointments.date, filters.dateTo),
  ]

  if (filters.practitionerId) {
    conditions.push(eq(appointments.practitionerId, filters.practitionerId))
  }

  const result = await db
    .select({
      id: appointments.id,
      tenantId: appointments.tenantId,
      patientId: appointments.patientId,
      practitionerId: appointments.practitionerId,
      procedureTypeId: appointments.procedureTypeId,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      source: appointments.source,
      bookingName: appointments.bookingName,
      bookingPhone: appointments.bookingPhone,
      bookingEmail: appointments.bookingEmail,
      notes: appointments.notes,
      createdAt: appointments.createdAt,
      updatedAt: appointments.updatedAt,
      patientName: patients.fullName,
      practitionerName: users.fullName,
      procedureTypeName: procedureTypes.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(users, eq(appointments.practitionerId, users.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(and(...conditions))
    .orderBy(appointments.date, appointments.startTime)

  return result
}

export async function getAppointmentById(
  tenantId: string,
  appointmentId: string
): Promise<AppointmentWithDetails | null> {
  const result = await db
    .select({
      id: appointments.id,
      tenantId: appointments.tenantId,
      patientId: appointments.patientId,
      practitionerId: appointments.practitionerId,
      procedureTypeId: appointments.procedureTypeId,
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      status: appointments.status,
      source: appointments.source,
      bookingName: appointments.bookingName,
      bookingPhone: appointments.bookingPhone,
      bookingEmail: appointments.bookingEmail,
      notes: appointments.notes,
      createdAt: appointments.createdAt,
      updatedAt: appointments.updatedAt,
      patientName: patients.fullName,
      practitionerName: users.fullName,
      procedureTypeName: procedureTypes.name,
    })
    .from(appointments)
    .leftJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(users, eq(appointments.practitionerId, users.id))
    .leftJoin(procedureTypes, eq(appointments.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        isNull(appointments.deletedAt)
      )
    )
    .limit(1)

  return result[0] ?? null
}

export async function checkTimeConflict(
  tenantId: string,
  practitionerId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeAppointmentId?: string
): Promise<boolean> {
  const conditions = [
    eq(appointments.tenantId, tenantId),
    eq(appointments.practitionerId, practitionerId),
    eq(appointments.date, date),
    isNull(appointments.deletedAt),
    // Not cancelled or no_show
    ne(appointments.status, 'cancelled'),
    ne(appointments.status, 'no_show'),
    // Overlap: existing.start < newEnd AND existing.end > newStart
    sql`${appointments.startTime} < ${endTime}::time`,
    sql`${appointments.endTime} > ${startTime}::time`,
  ]

  if (excludeAppointmentId) {
    conditions.push(ne(appointments.id, excludeAppointmentId))
  }

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointments)
    .where(and(...conditions))

  return Number(result[0].count) > 0
}

export async function createAppointment(
  tenantId: string,
  data: {
    patientId?: string | null
    practitionerId: string
    procedureTypeId?: string | null
    date: string
    startTime: string
    endTime: string
    status?: AppointmentStatus
    source?: AppointmentSource
    bookingName?: string
    bookingPhone?: string
    bookingEmail?: string
    notes?: string
  }
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    ...(data.patientId ? [verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient')] : []),
    verifyUserBelongsToTenant(tenantId, data.practitionerId, 'Practitioner'),
  ])

  const [result] = await db
    .insert(appointments)
    .values({
      tenantId,
      patientId: data.patientId ?? null,
      practitionerId: data.practitionerId,
      procedureTypeId: data.procedureTypeId ?? null,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      status: data.status ?? 'scheduled',
      source: data.source ?? 'internal',
      bookingName: data.bookingName,
      bookingPhone: data.bookingPhone,
      bookingEmail: data.bookingEmail,
      notes: data.notes,
    })
    .returning()

  return result
}

export async function updateAppointment(
  tenantId: string,
  appointmentId: string,
  data: Partial<{
    patientId: string | null
    practitionerId: string
    procedureTypeId: string | null
    date: string
    startTime: string
    endTime: string
    notes: string
  }>
) {
  const [result] = await db
    .update(appointments)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        isNull(appointments.deletedAt)
      )
    )
    .returning()

  return result
}

export async function updateAppointmentStatus(
  tenantId: string,
  appointmentId: string,
  status: AppointmentStatus
) {
  const [result] = await db
    .update(appointments)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        isNull(appointments.deletedAt)
      )
    )
    .returning()

  return result
}

export async function deleteAppointment(
  tenantId: string,
  appointmentId: string
) {
  const [result] = await db
    .update(appointments)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.id, appointmentId),
        isNull(appointments.deletedAt)
      )
    )
    .returning()

  return result
}

interface WorkingHoursDay {
  start: string
  end: string
  enabled: boolean
}

type WorkingHours = Record<string, WorkingHoursDay>

const DAY_MAP: Record<number, string> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
}

export async function getAvailableSlots(
  tenantId: string,
  practitionerId: string,
  date: string,
  durationMin: number = 30
): Promise<TimeSlot[]> {
  // Get tenant working hours
  const tenant = await db
    .select({ workingHours: tenants.workingHours })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const workingHours = (tenant[0]?.workingHours as WorkingHours | null) ?? (DEFAULT_WORKING_HOURS as unknown as WorkingHours)

  // Determine the day of week for the given date
  const dateObj = new Date(date + 'T12:00:00') // noon to avoid timezone issues
  const dayKey = DAY_MAP[dateObj.getDay()]
  const dayHours = dayKey ? workingHours[dayKey] : undefined

  if (!dayHours || !dayHours.enabled) {
    return []
  }

  // Get existing appointments for that day
  const existing = await db
    .select({
      startTime: appointments.startTime,
      endTime: appointments.endTime,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.practitionerId, practitionerId),
        eq(appointments.date, date),
        isNull(appointments.deletedAt),
        ne(appointments.status, 'cancelled'),
        ne(appointments.status, 'no_show')
      )
    )
    .orderBy(appointments.startTime)

  // Generate all possible slots within working hours
  const slots: TimeSlot[] = []
  const [startH, startM] = dayHours.start.split(':').map(Number)
  const [endH, endM] = dayHours.end.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  for (let m = startMinutes; m + durationMin <= endMinutes; m += 30) {
    const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const slotEndMin = m + durationMin
    const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`

    // Check if this slot conflicts with any existing appointment
    const hasConflict = existing.some((appt) => {
      return appt.startTime < slotEnd && appt.endTime > slotStart
    })

    if (!hasConflict) {
      slots.push({ start: slotStart, end: slotEnd })
    }
  }

  return slots
}

export async function listPractitioners(tenantId: string) {
  const { tenantUsers } = await import('@/db/schema')

  const result = await db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(users)
    .innerJoin(
      tenantUsers,
      and(
        eq(tenantUsers.userId, users.id),
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.isActive, true),
        or(
          eq(tenantUsers.role, 'practitioner'),
          eq(tenantUsers.role, 'owner')
        )
      )
    )
    .where(isNull(users.deletedAt))
    .orderBy(users.fullName)

  return result
}
