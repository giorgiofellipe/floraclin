import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  updateExpenseCategory,
  deleteExpenseCategory,
} from '@/db/queries/financial-settings'
import { expenseCategorySchema } from '@/validations/expenses'
import { handleApiError } from '@/lib/api-error'

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
    if (msg.includes('não encontrada') || msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('owner')
    const { id } = await params

    await deleteExpenseCategory(ctx.tenantId, ctx.userId, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('não encontrada') || msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    return handleApiError(error, request)
  }
}
