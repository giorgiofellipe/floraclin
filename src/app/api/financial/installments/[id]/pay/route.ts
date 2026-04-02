import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { recordPayment } from '@/db/queries/financial'
import { recordPaymentSchema } from '@/validations/financial'

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
    const parsed = recordPaymentSchema.safeParse({
      installmentId: id,
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      paidAt: body.paidAt,
      notes: body.notes,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await recordPayment(ctx.tenantId, ctx.userId, parsed.data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'installment',
      entityId: id,
      changes: {
        payment: {
          old: null,
          new: {
            amount: parsed.data.amount,
            paymentMethod: parsed.data.paymentMethod,
            allocation: result.allocation,
          },
        },
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontrada') || msg.includes('já está') || msg.includes('cancelada')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
