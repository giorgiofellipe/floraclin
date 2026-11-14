import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listRecentPatients } from '@/db/queries/patients'
import { handleApiError } from '@/lib/api-error'

const RECENT_LIMIT = 5

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Same scope as the patient search: practitioners only see their own patients.
    const responsibleUserId = ctx.role === 'practitioner' ? ctx.userId : undefined
    const data = await listRecentPatients(ctx.tenantId, { limit: RECENT_LIMIT, responsibleUserId })
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}
