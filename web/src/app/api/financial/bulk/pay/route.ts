import { NextResponse, after } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { bulkPayInstallments } from '@/db/queries/financial'
import { bulkPaySchema } from '@/validations/financial'
import { BusinessError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { sendPaymentConfirmations } from '@/lib/whatsapp-payment-confirmation'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'receptionist', 'financial')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = bulkPaySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const results = await bulkPayInstallments(ctx.tenantId, ctx.userId, parsed.data)
    after(() => sendPaymentConfirmations(ctx.tenantId, results.map((r) => r.paymentRecord)))

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
