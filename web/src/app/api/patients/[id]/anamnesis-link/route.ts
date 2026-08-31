import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { createAnamnesisToken } from '@/db/queries/anamnesis-tokens'
import { getAppUrl } from '@/lib/app-url'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: patientId } = await params
    const patient = await getPatient(ctx.tenantId, patientId)
    if (!patient) {
      return NextResponse.json({ error: 'Paciente não encontrado' }, { status: 404 })
    }

    const token = await createAnamnesisToken(ctx.tenantId, patientId, ctx.userId)
    const url = `${getAppUrl()}/a/${token.token}`

    return NextResponse.json({ url, expiresAt: token.expiresAt })
  } catch (error) {
    return handleApiError(error, request)
  }
}
