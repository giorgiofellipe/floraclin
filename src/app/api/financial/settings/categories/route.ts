import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  getExpenseCategories,
  createExpenseCategory,
} from '@/db/queries/financial-settings'
import { expenseCategorySchema } from '@/validations/expenses'

export async function GET() {
  try {
    const ctx = await requireRole('owner', 'financial')

    const categories = await getExpenseCategories(ctx.tenantId)

    return NextResponse.json({ data: categories })
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
    const ctx = await requireRole('owner')

    const body = await request.json()
    const parsed = expenseCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const category = await createExpenseCategory(ctx.tenantId, ctx.userId, parsed.data)

    return NextResponse.json({ success: true, data: category })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
