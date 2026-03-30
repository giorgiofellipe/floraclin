import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listAuditLogs } from '@/db/queries/audit'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const entityType = searchParams.get('entityType') ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo = searchParams.get('dateTo') ?? undefined
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')

    const data = await listAuditLogs(ctx.tenantId, {
      entityType,
      entityId,
      dateFrom,
      dateTo,
      page,
      limit,
    })

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
