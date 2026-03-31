import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPractitionerPL } from '@/db/queries/cash-movements'
import { revenueFilterSchema } from '@/validations/financial'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()

    // Roles: owner, financial (all practitioners), practitioner (self only)
    if (!['owner', 'financial', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const rawFilters = {
      dateFrom: searchParams.get('dateFrom') ?? '',
      dateTo: searchParams.get('dateTo') ?? '',
      practitionerId: searchParams.get('practitionerId') ?? undefined,
    }

    const parsed = revenueFilterSchema.safeParse(rawFilters)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros invalidos' }, { status: 400 })
    }

    // Practitioner role: force to their own user ID
    let practitionerId = parsed.data.practitionerId
    if (ctx.role === 'practitioner') {
      practitionerId = ctx.userId
    }

    const practitioners = await getPractitionerPL(
      ctx.tenantId,
      parsed.data.dateFrom,
      parsed.data.dateTo,
      practitionerId
    )

    return NextResponse.json(practitioners)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
