import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { bulkPayInstallments } from '@/db/queries/financial'
import { bulkPaySchema } from '@/validations/financial'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Bulk pay: owner + receptionist + financial
    if (!['owner', 'receptionist', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = bulkPaySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const results = await bulkPayInstallments(ctx.tenantId, ctx.userId, parsed.data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'installment',
      changes: {
        bulkPay: {
          old: null,
          new: {
            installmentIds: parsed.data.installmentIds,
            paymentMethod: parsed.data.paymentMethod,
            count: results.length,
          },
        },
      },
    })

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontradas') || msg.includes('já pagas')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
