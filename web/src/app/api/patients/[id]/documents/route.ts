import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { listClinicalDocumentsForPatient } from '@/db/queries/clinical-documents'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id: patientId } = await params

    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const documents = await listClinicalDocumentsForPatient(ctx.tenantId, patientId)
    return NextResponse.json({ data: documents })
  } catch (error) {
    return handleApiError(error, request)
  }
}
