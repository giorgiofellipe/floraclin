'use server'

import { requireRole, getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  updateStatusSchema,
} from '@/validations/appointment'
import {
  listAppointments as listAppointmentsQuery,
  createAppointment as createAppointmentQuery,
  updateAppointment as updateAppointmentQuery,
  updateAppointmentStatus as updateAppointmentStatusQuery,
  deleteAppointment as deleteAppointmentQuery,
  checkTimeConflict,
  getAvailableSlots as getAvailableSlotsQuery,
  listPractitioners as listPractitionersQuery,
  getAppointmentById,
} from '@/db/queries/appointments'
import type { AppointmentStatus } from '@/types'

export type AppointmentActionState = {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
} | null

export async function createAppointmentAction(
  _prevState: AppointmentActionState,
  formData: FormData
): Promise<AppointmentActionState> {
  const context = await requireRole('owner', 'practitioner', 'receptionist')

  const raw = {
    patientId: formData.get('patientId') as string || null,
    practitionerId: formData.get('practitionerId') as string,
    procedureTypeId: formData.get('procedureTypeId') as string || null,
    date: formData.get('date') as string,
    startTime: formData.get('startTime') as string,
    endTime: formData.get('endTime') as string,
    notes: formData.get('notes') as string || undefined,
    source: 'internal' as const,
    bookingName: formData.get('bookingName') as string || undefined,
    bookingPhone: formData.get('bookingPhone') as string || undefined,
    bookingEmail: formData.get('bookingEmail') as string || undefined,
  }

  const parsed = createAppointmentSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { data } = parsed

  // UX courtesy conflict check (DB exclusion constraint is the real enforcement)
  const hasConflict = await checkTimeConflict(
    context.tenantId,
    data.practitionerId,
    data.date,
    data.startTime,
    data.endTime
  )

  if (hasConflict) {
    return { error: 'Já existe um agendamento neste horário para este profissional.' }
  }

  try {
    const appointment = await createAppointmentQuery(context.tenantId, {
      patientId: data.patientId,
      practitionerId: data.practitionerId,
      procedureTypeId: data.procedureTypeId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      notes: data.notes,
      source: data.source,
      bookingName: data.bookingName,
      bookingPhone: data.bookingPhone,
      bookingEmail: data.bookingEmail,
    })

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'create',
      entityType: 'appointment',
      entityId: appointment.id,
    })

    return { success: true }
  } catch (err) {
    // DB exclusion constraint violation
    if (err instanceof Error && err.message.includes('exclusion')) {
      return { error: 'Conflito de horário detectado. Escolha outro horário.' }
    }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }
}

export async function updateAppointmentAction(
  _prevState: AppointmentActionState,
  formData: FormData
): Promise<AppointmentActionState> {
  const context = await requireRole('owner', 'practitioner', 'receptionist')

  const raw = {
    id: formData.get('id') as string,
    patientId: formData.get('patientId') as string || undefined,
    practitionerId: formData.get('practitionerId') as string || undefined,
    procedureTypeId: formData.get('procedureTypeId') as string || undefined,
    date: formData.get('date') as string || undefined,
    startTime: formData.get('startTime') as string || undefined,
    endTime: formData.get('endTime') as string || undefined,
    notes: formData.get('notes') as string || undefined,
  }

  const parsed = updateAppointmentSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { id, ...data } = parsed.data

  // Get current appointment to fill in missing fields for conflict check
  const current = await getAppointmentById(context.tenantId, id)
  if (!current) {
    return { error: 'Agendamento não encontrado.' }
  }

  const checkDate = data.date ?? current.date
  const checkStart = data.startTime ?? current.startTime
  const checkEnd = data.endTime ?? current.endTime
  const checkPractitioner = data.practitionerId ?? current.practitionerId

  // Validate that startTime < endTime after merging partial updates
  if (checkStart >= checkEnd) {
    return { error: 'O horário de início deve ser anterior ao horário de término.' }
  }

  if (data.date || data.startTime || data.endTime || data.practitionerId) {
    const hasConflict = await checkTimeConflict(
      context.tenantId,
      checkPractitioner,
      checkDate,
      checkStart,
      checkEnd,
      id
    )

    if (hasConflict) {
      return { error: 'Já existe um agendamento neste horário para este profissional.' }
    }
  }

  try {
    const appointment = await updateAppointmentQuery(context.tenantId, id, data)

    if (!appointment) {
      return { error: 'Agendamento não encontrado.' }
    }

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'update',
      entityType: 'appointment',
      entityId: id,
    })

    return { success: true }
  } catch (err) {
    if (err instanceof Error && err.message.includes('exclusion')) {
      return { error: 'Conflito de horário detectado. Escolha outro horário.' }
    }
    return { error: 'Erro ao atualizar agendamento. Tente novamente.' }
  }
}

export async function updateAppointmentStatusAction(
  id: string,
  status: AppointmentStatus
): Promise<AppointmentActionState> {
  const context = await requireRole('owner', 'practitioner', 'receptionist')

  const parsed = updateStatusSchema.safeParse({ id, status })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const appointment = await updateAppointmentStatusQuery(
    context.tenantId,
    parsed.data.id,
    parsed.data.status as AppointmentStatus
  )

  if (!appointment) {
    return { error: 'Agendamento não encontrado.' }
  }

  await createAuditLog({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'update',
    entityType: 'appointment',
    entityId: id,
    changes: { status: { old: '', new: status } },
  })

  return { success: true }
}

export async function deleteAppointmentAction(id: string): Promise<AppointmentActionState> {
  const context = await requireRole('owner', 'practitioner', 'receptionist')

  const appointment = await deleteAppointmentQuery(context.tenantId, id)

  if (!appointment) {
    return { error: 'Agendamento não encontrado.' }
  }

  await createAuditLog({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'delete',
    entityType: 'appointment',
    entityId: id,
  })

  return { success: true }
}

export async function listAppointmentsAction(
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
) {
  const context = await getAuthContext()

  return listAppointmentsQuery(context.tenantId, {
    practitionerId,
    dateFrom,
    dateTo,
  })
}

export async function getAvailableSlotsAction(
  practitionerId: string,
  date: string,
  durationMin?: number
) {
  const context = await getAuthContext()
  return getAvailableSlotsQuery(context.tenantId, practitionerId, date, durationMin)
}

export async function listPractitionersAction() {
  const context = await getAuthContext()
  return listPractitionersQuery(context.tenantId)
}

export async function listPatientsForSelectAction(search?: string) {
  const context = await getAuthContext()
  const { patients } = await import('@/db/schema')
  const { db } = await import('@/db/client')
  const { eq, and, isNull, ilike } = await import('drizzle-orm')

  const conditions = [
    eq(patients.tenantId, context.tenantId),
    isNull(patients.deletedAt),
  ]

  if (search && search.length >= 2) {
    const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
    conditions.push(ilike(patients.fullName, `%${escaped}%`))
  }

  const result = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
    })
    .from(patients)
    .where(and(...conditions))
    .orderBy(patients.fullName)
    .limit(20)

  return result
}

export async function listProcedureTypesForSelectAction() {
  const context = await getAuthContext()
  const { procedureTypes } = await import('@/db/schema')
  const { db } = await import('@/db/client')
  const { eq, and, isNull } = await import('drizzle-orm')

  const result = await db
    .select({
      id: procedureTypes.id,
      name: procedureTypes.name,
      estimatedDurationMin: procedureTypes.estimatedDurationMin,
    })
    .from(procedureTypes)
    .where(
      and(
        eq(procedureTypes.tenantId, context.tenantId),
        eq(procedureTypes.isActive, true),
        isNull(procedureTypes.deletedAt)
      )
    )
    .orderBy(procedureTypes.name)

  return result
}
