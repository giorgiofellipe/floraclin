import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { getAppointmentById } from '@/db/queries/appointments'
import { canSendRescheduleNotice } from '@/validations/appointment'
import { brToday } from '@/lib/dates'
import { sendRescheduleNotification } from '@/lib/whatsapp-reschedule'
import { handleApiError } from '@/lib/api-error'

// POST /api/appointments/[id]/reschedule-notice: tells the patient about a move that was saved without a notice (agenda drag).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id } = await params
    const appointment = await getAppointmentById(ctx.tenantId, id)
    if (!appointment) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }
    if (!canSendRescheduleNotice(appointment.status, appointment.date, brToday())) {
      return NextResponse.json({ error: 'Este agendamento não aceita aviso de reagendamento.' }, { status: 400 })
    }

    const notification = await sendRescheduleNotification(ctx.tenantId, ctx.userId, appointment)
    return NextResponse.json({ success: true, notification })
  } catch (error) {
    return handleApiError(error, request)
  }
}
