import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPractitioners } from '@/db/queries/appointments'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const data = await listPractitioners(ctx.tenantId)
    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, request)
  }
}
