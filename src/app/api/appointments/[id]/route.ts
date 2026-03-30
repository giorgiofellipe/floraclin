import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getAppointmentById,
  updateAppointment,
  deleteAppointment,
  checkTimeConflict,
} from '@/db/queries/appointments'
import { updateAppointmentSchema } from '@/validations/appointment'

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

    return NextResponse.json({ success: true, data: appointment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('exclusion')) {
      return NextResponse.json(
        { error: 'Conflito de horário detectado. Escolha outro horário.' },
        { status: 409 }
      )
    }
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
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

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
