import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getReceivablesTotals } from '@/db/queries/financial'
import { hasRole, RECEIVABLES_VIEWER_ROLES } from '@/lib/financial/charge-roles'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!hasRole(RECEIVABLES_VIEWER_ROLES, ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(await getReceivablesTotals(ctx.tenantId))
  } catch (error) {
    return handleApiError(error, request)
  }
}
