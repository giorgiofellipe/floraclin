import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { listClinicalDocumentsForPatient } from '@/db/queries/clinical-documents'

export async function GET(
  _request: Request,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
