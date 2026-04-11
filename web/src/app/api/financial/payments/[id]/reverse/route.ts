import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { reversePayment } from '@/db/queries/financial'
import { z } from 'zod'

const reversePaymentSchema = z.object({
  reason: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()

    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: paymentRecordId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = reversePaymentSchema.safeParse(body)

    const result = await reversePayment(
      ctx.tenantId,
      ctx.userId,
      paymentRecordId,
      parsed.success ? parsed.data.reason : undefined
    )

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('não encontrado') || msg.includes('não pertence') || msg.includes('já foi estornado')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('Reverse payment API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
