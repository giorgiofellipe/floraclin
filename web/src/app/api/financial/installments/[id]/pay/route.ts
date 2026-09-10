import { NextResponse } from 'next/server'
import { createAuditLog } from '@/lib/audit'
import { requireWrite } from '@/lib/write-access'
import { recordPayment } from '@/db/queries/financial'
import { recordPaymentSchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'receptionist', 'financial')
    if (blocked) return blocked

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
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
