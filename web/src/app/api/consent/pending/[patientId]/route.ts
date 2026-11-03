import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPendingConsents } from '@/db/queries/consent'
import { getPatient } from '@/db/queries/patients'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { patientId } = await params
    if (!(await getPatient(ctx.tenantId, patientId))) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }
    const data = await listPendingConsents(ctx.tenantId, patientId)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
