import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getConsentHistory, getConsentForProcedure } from '@/db/queries/consent'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { patientId } = await params
    const { searchParams } = new URL(request.url)
    const procedureId = searchParams.get('procedureId')
    const type = searchParams.get('type')

    // If filtering by procedure + type, return single check
    if (procedureId && type) {
      const acceptance = await getConsentForProcedure(ctx.tenantId, patientId, procedureId, type)
      return NextResponse.json({ data: acceptance ?? null })
    }

    const history = await getConsentHistory(ctx.tenantId, patientId)
    return NextResponse.json(history)
  } catch (error) {
    return handleApiError(error, request)
  }
}
