import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPreviousDiagramPoints } from '@/db/queries/face-diagrams'
import { getPatient } from '@/db/queries/patients'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    const excludeProcedureId = searchParams.get('excludeProcedureId') ?? undefined

    if (!patientId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }
    if (!(await getPatient(ctx.tenantId, patientId))) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const points = await getPreviousDiagramPoints(ctx.tenantId, patientId, excludeProcedureId)
    return NextResponse.json(points)
  } catch (error) {
    return handleApiError(error, request)
  }
}
