import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
import {
  getAppointmentById,
  updateAppointment,
  deleteAppointment,
  checkTimeConflict,
} from '@/db/queries/appointments'
import { updateAppointmentSchema } from '@/validations/appointment'
import { handleApiError } from '@/lib/api-error'
import { reportCalendarFailure } from '@/lib/google-calendar'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateAppointmentSchema.safeParse({ ...body, id })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { id: appointmentId, ...data } = parsed.data

    const current = await getAppointmentById(ctx.tenantId, appointmentId)
    if (!current) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }

    const checkDate = data.date ?? current.date
    const checkStart = data.startTime ?? current.startTime
    const checkEnd = data.endTime ?? current.endTime
    const checkPractitioner = data.practitionerId ?? current.practitionerId

    if (checkStart >= checkEnd) {
      return NextResponse.json(
        { error: 'O horário de início deve ser anterior ao horário de término.' },
        { status: 400 }
      )
    }

    if (data.date || data.startTime || data.endTime || data.practitionerId) {
      const hasConflict = await checkTimeConflict(
        ctx.tenantId,
        checkPractitioner,
        checkDate,
        checkStart,
        checkEnd,
        appointmentId
      )

      if (hasConflict) {
        return NextResponse.json(
          { error: 'Já existe um agendamento neste horário para este profissional.' },
          { status: 409 }
        )
      }
    }

    const appointment = await updateAppointment(ctx.tenantId, appointmentId, data)
    if (!appointment) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'appointment',
      entityId: appointmentId,
    })

    syncAppointmentToGoogle(ctx.tenantId, appointmentId).catch((err) => {
      reportCalendarFailure(err, 'push_appointment', { appointmentId })
    })

    return NextResponse.json({ success: true, data: appointment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('exclusion')) {
      return NextResponse.json(
        { error: 'Conflito de horário detectado. Escolha outro horário.' },
        { status: 409 }
      )
    }
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const appointment = await deleteAppointment(ctx.tenantId, id)
    if (!appointment) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'appointment',
      entityId: id,
    })

    syncAppointmentToGoogle(ctx.tenantId, id).catch((err) => {
      reportCalendarFailure(err, 'push_appointment', { appointmentId: id })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
