import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getAppointmentById } from '@/db/queries/appointments'
import { nextRescheduleSlots } from '@/lib/booking-slots'
import { timeToMinutes } from '@/lib/free-slots'
import { handleApiError } from '@/lib/api-error'

const SLOT_LIMIT = 12
const SLOTS_PER_DAY = 4

// GET /api/appointments/[id]/free-slots: where this appointment can move, same practitioner and duration.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params
    const appointment = await getAppointmentById(ctx.tenantId, id)
    if (!appointment) {
      return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })
    }
    const durationMin = timeToMinutes(appointment.endTime) - timeToMinutes(appointment.startTime)
    const data = await nextRescheduleSlots(
      ctx.tenantId,
      { id: appointment.id, practitionerId: appointment.practitionerId, durationMin, date: appointment.date, startTime: appointment.startTime },
      { limit: SLOT_LIMIT, perDay: SLOTS_PER_DAY },
    )
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
