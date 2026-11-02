import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { getPatientFinancialSummary } from '@/db/queries/financial'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial', 'receptionist', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    const patient = await getPatient(ctx.tenantId, id)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const data = await getPatientFinancialSummary(ctx.tenantId, id)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
