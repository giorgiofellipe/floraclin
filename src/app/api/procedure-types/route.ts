import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listProcedureTypes } from '@/db/queries/tenants'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const data = await listProcedureTypes(ctx.tenantId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
