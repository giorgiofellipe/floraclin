import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listCashMovements, getLedgerSummary } from '@/db/queries/cash-movements'
import { ledgerFilterSchema } from '@/validations/financial'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Ledger: owner, financial, receptionist
    if (!['owner', 'financial', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const rawFilters = {
      type: searchParams.get('type') ?? 'all',
      dateFrom: searchParams.get('dateFrom') ?? '',
      dateTo: searchParams.get('dateTo') ?? '',
      paymentMethod: searchParams.get('paymentMethod') ?? undefined,
      patientId: searchParams.get('patientId') ?? undefined,
      categoryId: searchParams.get('categoryId') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 50,
    }

    const parsed = ledgerFilterSchema.safeParse(rawFilters)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros invalidos' }, { status: 400 })
    }

    const [movementsResult, summary] = await Promise.all([
      listCashMovements(ctx.tenantId, parsed.data),
      getLedgerSummary(ctx.tenantId, parsed.data.dateFrom, parsed.data.dateTo),
    ])

    return NextResponse.json({
      movements: movementsResult.data,
      summary,
      pagination: {
        total: movementsResult.total,
        page: movementsResult.page,
        limit: movementsResult.limit,
        totalPages: movementsResult.totalPages,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
