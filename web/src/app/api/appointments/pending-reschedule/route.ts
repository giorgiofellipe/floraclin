import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPendingRescheduleAppointments } from '@/db/queries/appointments'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const practitionerId = ctx.role === 'practitioner' ? ctx.userId : undefined
    const data = await getPendingRescheduleAppointments(ctx.tenantId, practitionerId)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
