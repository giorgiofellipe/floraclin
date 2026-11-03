import { NextResponse, after } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { reversePayment } from '@/db/queries/financial'
import { reversePaymentSchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { processCancellation } from '@/lib/nfse/emission'

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
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { nfseCancelDocumentIds, ...result } = await reversePayment(
      ctx.tenantId,
      ctx.userId,
      paymentRecordId,
      parsed.data.reason,
      { cancelNfse: parsed.data.cancelNfse }
    )
    if (nfseCancelDocumentIds.length > 0) {
      after(async () => {
        for (const id of nfseCancelDocumentIds) await processCancellation(id)
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
