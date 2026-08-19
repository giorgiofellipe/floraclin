import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { syncAppointmentToGoogle } from '@/lib/google-calendar-sync'
import { updateAppointmentStatus } from '@/db/queries/appointments'
import { updateStatusSchema } from '@/validations/appointment'
import type { AppointmentStatus } from '@/types'
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
    const parsed = updateStatusSchema.safeParse({ id, status: body.status })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const appointment = await updateAppointmentStatus(
      ctx.tenantId,
      parsed.data.id,
      parsed.data.status as AppointmentStatus
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'appointment',
      entityId: id,
      changes: { status: { old: '', new: body.status } },
    })

    syncAppointmentToGoogle(ctx.tenantId, id).catch((err) => {
      reportCalendarFailure(err, 'push_appointment', { appointmentId: id })
    })

    return NextResponse.json({ success: true, data: appointment })
  } catch (error) {
    return handleApiError(error, request)
  }
}
