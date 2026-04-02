import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listExpenses, createExpense } from '@/db/queries/expenses'
import { expenseFilterSchema, createExpenseSchema } from '@/validations/expenses'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const filters = {
      status: searchParams.get('status') ?? undefined,
      categoryId: searchParams.get('categoryId') ?? undefined,
      isOverdue: searchParams.get('isOverdue') === 'true' ? true : undefined,
      paymentMethod: searchParams.get('paymentMethod') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    }

    const parsed = expenseFilterSchema.safeParse(filters)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
    }

    const data = await listExpenses(ctx.tenantId, parsed.data)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createExpenseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const expense = await createExpense(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: expense })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('Categoria não encontrada')) return NextResponse.json({ error: msg }, { status: 400 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
