import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { requireWrite } from '@/lib/write-access'
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
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

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

    // Stored times carry seconds; the request does not. Normalize before any comparison.
    const hhmm = (t: string) => t.slice(0, 5)
    const checkDate = data.date ?? current.date
    const checkStart = hhmm(data.startTime ?? current.startTime)
    const checkEnd = hhmm(data.endTime ?? current.endTime)
    const checkPractitioner = data.practitionerId ?? current.practitionerId

    if (checkStart >= checkEnd) {
      return NextResponse.json(
        { error: 'O horário de início deve ser anterior ao horário de término.' },
        { status: 400 }
      )
    }

    // The form resends the whole slot on every edit; only a moved slot can newly conflict.
    const slotChanged =
      checkDate !== current.date ||
      checkStart !== hhmm(current.startTime) ||
      checkEnd !== hhmm(current.endTime) ||
      checkPractitioner !== current.practitionerId

    if (slotChanged) {
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
          { error: 'Horário indisponível para este profissional.' },
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

    void syncAppointmentToGoogle(ctx.tenantId, appointmentId)

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
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

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

    void syncAppointmentToGoogle(ctx.tenantId, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
