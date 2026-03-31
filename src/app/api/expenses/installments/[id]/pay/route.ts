import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { payExpenseInstallment } from '@/db/queries/expenses'
import { payExpenseInstallmentSchema } from '@/validations/expenses'
import type { PaymentMethod } from '@/types'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontrada') || msg.includes('já foi paga')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
