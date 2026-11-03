import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { listPatientAppointments } from '@/db/queries/appointments'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params

    const patient = await getPatient(ctx.tenantId, id)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const data = await listPatientAppointments(ctx.tenantId, id)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
