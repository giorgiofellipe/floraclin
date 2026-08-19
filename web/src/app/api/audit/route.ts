import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listAuditLogs, getDistinctEntityTypes } from '@/db/queries/audit'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)

    // Check if this is a request for distinct entity types
    if (searchParams.get('distinct') === 'entityTypes') {
      const types = await getDistinctEntityTypes(ctx.tenantId)
      return NextResponse.json(types)
    }

    const filters = {
      entityType: searchParams.get('entityType') ?? undefined,
      entityId: searchParams.get('entityId') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    }

    const data = await listAuditLogs(ctx.tenantId, filters)
    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, request)
  }
}
