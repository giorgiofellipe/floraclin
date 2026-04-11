import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  updateExpenseCategory,
  deleteExpenseCategory,
} from '@/db/queries/financial-settings'
import { expenseCategorySchema } from '@/validations/expenses'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params

    const body = await request.json()
    const parsed = expenseCategorySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const category = await updateExpenseCategory(ctx.tenantId, ctx.userId, id, parsed.data)

    return NextResponse.json({ success: true, data: category })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('não encontrada') || msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params

    await deleteExpenseCategory(ctx.tenantId, ctx.userId, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('não encontrada') || msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
