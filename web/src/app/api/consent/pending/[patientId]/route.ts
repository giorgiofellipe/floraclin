import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPendingConsents } from '@/db/queries/consent'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { patientId } = await params
    const data = await listPendingConsents(ctx.tenantId, patientId)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
