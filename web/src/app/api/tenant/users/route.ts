import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listTenantUsers } from '@/db/queries/users'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const users = await listTenantUsers(ctx.tenantId)
    return NextResponse.json(users)
  } catch (error) {
    return handleApiError(error, request)
  }
}
