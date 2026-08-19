import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { payExpenseInstallment, revertExpenseInstallmentPayment } from '@/db/queries/expenses'
import { payExpenseInstallmentSchema, revertExpenseInstallmentSchema } from '@/validations/expenses'
import type { PaymentMethod } from '@/types'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = payExpenseInstallmentSchema.safeParse({
      installmentId: id,
      paymentMethod: body.paymentMethod,
      paidAt: body.paidAt,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const installment = await payExpenseInstallment(
      ctx.tenantId,
      parsed.data.installmentId,
      parsed.data.paymentMethod as PaymentMethod,
      ctx.userId,
      parsed.data.paidAt
    )

    return NextResponse.json({ success: true, data: installment })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const raw = await request.text()
    const body = raw ? JSON.parse(raw) : {}
    const parsed = revertExpenseInstallmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const installment = await revertExpenseInstallmentPayment(
      ctx.tenantId,
      id,
      ctx.userId,
      parsed.data.reason,
    )

    return NextResponse.json({ success: true, data: installment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''

    if (
      msg.includes('não encontrada') ||
      msg.includes('não está paga') ||
      msg.includes('Despesa cancelada')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return handleApiError(error, request)
  }
}
