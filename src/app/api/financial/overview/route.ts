import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getRevenueOverview } from '@/db/queries/financial'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const dateFrom = searchParams.get('dateFrom') ?? ''
    const dateTo = searchParams.get('dateTo') ?? ''
    const practitionerId = searchParams.get('practitionerId') ?? undefined

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required' },
        { status: 400 }
      )
    }

    const data = await getRevenueOverview(ctx.tenantId, dateFrom, dateTo, practitionerId)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
