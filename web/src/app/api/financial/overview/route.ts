import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getRevenueOverview } from '@/db/queries/financial'
import { revenueFilterSchema } from '@/validations/financial'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Revenue overview: owner + financial only
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const filters = {
      dateFrom: searchParams.get('dateFrom') ?? '',
      dateTo: searchParams.get('dateTo') ?? '',
      practitionerId: searchParams.get('practitionerId') ?? undefined,
    }

    const parsed = revenueFilterSchema.safeParse(filters)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
    }

    const overview = await getRevenueOverview(
      ctx.tenantId,
      parsed.data.dateFrom,
      parsed.data.dateTo,
      parsed.data.practitionerId
    )

    return NextResponse.json(overview)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
