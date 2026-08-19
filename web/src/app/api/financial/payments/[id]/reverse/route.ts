import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
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
    return handleApiError(error, request)
  }
}
