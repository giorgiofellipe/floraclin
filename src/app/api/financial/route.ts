import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listFinancialEntries } from '@/db/queries/financial'
import type { FinancialStatus } from '@/types'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const patientId = searchParams.get('patientId') ?? undefined
    const status = (searchParams.get('status') as FinancialStatus) ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo = searchParams.get('dateTo') ?? undefined
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')

    const data = await listFinancialEntries(ctx.tenantId, {
      patientId,
      status,
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
