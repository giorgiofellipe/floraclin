import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getExpense, cancelExpense, updateExpense } from '@/db/queries/expenses'
import { updateExpenseSchema } from '@/validations/expenses'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const expense = await getExpense(ctx.tenantId, id)
    if (!expense) {
      return NextResponse.json({ error: 'Despesa não encontrada' }, { status: 404 })
    }

    return NextResponse.json(expense)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

    const { id } = await params
    const result = await cancelExpense(ctx.tenantId, id, ctx.userId)

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('não encontrada') || msg.includes('já está cancelada')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

    const { id } = await params
    const body = await request.json()
    const parsed = updateExpenseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await updateExpense(ctx.tenantId, id, ctx.userId, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''

    if (
      msg.includes('Despesa não encontrada') ||
      msg.includes('Despesa cancelada') ||
      msg.includes('Valor menor') ||
      msg.includes('Parcelas menor') ||
      msg.includes('Valor e parcelas inconsistentes') ||
      msg.includes('Quantidade de datas') ||
      msg.includes('Categoria não encontrada')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return handleApiError(error, request)
  }
}
