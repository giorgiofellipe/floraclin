import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { payInstallment } from '@/db/queries/financial'
import { payInstallmentSchema } from '@/validations/financial'
import type { PaymentMethod } from '@/types'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    // Pay installment: owner + receptionist + financial
    if (!['owner', 'receptionist', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = payInstallmentSchema.safeParse({
      installmentId: id,
      paymentMethod: body.paymentMethod,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const installment = await withTransaction(async (tx) => {
      const result = await payInstallment(
        ctx.tenantId,
        parsed.data.installmentId,
        parsed.data.paymentMethod as PaymentMethod,
        tx
      )

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'installment',
        entityId: result.id,
        changes: {
          status: { old: 'pending', new: 'paid' },
          paymentMethod: { old: null, new: body.paymentMethod },
        },
      }, tx)

      return result
    })

    return NextResponse.json({ success: true, data: installment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
