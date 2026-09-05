import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { reversePayment } from '@/db/queries/financial'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-error'

const reversePaymentSchema = z.object({
  reason: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'financial')
    if (blocked) return blocked

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
    if (msg.includes('não encontrado') || msg.includes('não pertence') || msg.includes('já foi estornado')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return handleApiError(error, request)
  }
}
