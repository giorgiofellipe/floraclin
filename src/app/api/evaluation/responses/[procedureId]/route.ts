import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getEvaluationResponsesForProcedure } from '@/db/queries/evaluation-responses'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ procedureId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { procedureId } = await params
    const data = await getEvaluationResponsesForProcedure(ctx.tenantId, procedureId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
