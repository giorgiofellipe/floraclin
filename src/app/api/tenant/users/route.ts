import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listTenantUsers } from '@/db/queries/users'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const data = await listTenantUsers(ctx.tenantId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
