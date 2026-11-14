import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getFinancialOverview } from '@/db/queries/financial'
import { MONTH_PARAM_RE } from '@/db/queries/dashboard'
import { handleApiError } from '@/lib/api-error'
import { OVERVIEW_ROLES } from '@/lib/financial/account-roles'
import { brToday } from '@/lib/dates'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!OVERVIEW_ROLES.includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const month = new URL(request.url).searchParams.get('month') ?? brToday().slice(0, 7)
    if (!MONTH_PARAM_RE.test(month)) {
      return NextResponse.json({ error: 'Mês inválido (esperado YYYY-MM)' }, { status: 400 })
    }

    return NextResponse.json(await getFinancialOverview(ctx.tenantId, month))
  } catch (error) {
    return handleApiError(error, request)
  }
}
