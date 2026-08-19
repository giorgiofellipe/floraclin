import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getLatestNonExecutedProcedure } from '@/db/queries/procedures'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
    }

    const procedure = await getLatestNonExecutedProcedure(ctx.tenantId, patientId).catch(() => null)
    return NextResponse.json(procedure)
  } catch (error) {
    return handleApiError(error, request)
  }
}
