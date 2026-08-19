import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getEvaluationResponsesForProcedure } from '@/db/queries/evaluation-responses'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ procedureId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { procedureId } = await params
    const responses = await getEvaluationResponsesForProcedure(ctx.tenantId, procedureId)
    return NextResponse.json(responses)
  } catch (error) {
    return handleApiError(error, request)
  }
}
