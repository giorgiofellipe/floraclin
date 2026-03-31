import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { exportLedgerCSV } from '@/db/queries/cash-movements'
import { ledgerFilterSchema } from '@/validations/financial'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // CSV export: owner, financial only
    if (!['owner', 'financial'].includes(ctx.role)) {
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
    }

    // Validate with ledgerFilterSchema (page/limit will get defaults but we ignore them)
    const parsed = ledgerFilterSchema.safeParse({ ...rawFilters, page: 1, limit: 50 })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros invalidos' }, { status: 400 })
    }

    const csv = await exportLedgerCSV(ctx.tenantId, {
      type: parsed.data.type,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      paymentMethod: parsed.data.paymentMethod,
      patientId: parsed.data.patientId,
      categoryId: parsed.data.categoryId,
    })

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="extrato-${parsed.data.dateFrom}-${parsed.data.dateTo}.csv"`,
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
