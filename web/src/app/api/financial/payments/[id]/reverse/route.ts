import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { reversePayment } from '@/db/queries/financial'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

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
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
