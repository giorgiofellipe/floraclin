import { NextResponse, after } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { bulkPayInstallments } from '@/db/queries/financial'
import { bulkPaySchema } from '@/validations/financial'
import { BusinessError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { processDocuments } from '@/lib/nfse/emission'
import { sendPaymentConfirmations } from '@/lib/whatsapp-payment-confirmation'
import { CHARGE_PAYER_ROLES } from '@/lib/financial/charge-roles'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite(...CHARGE_PAYER_ROLES)
    if (blocked) return blocked

    const body = await request.json()
    const parsed = bulkPaySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { results, nfse } = await bulkPayInstallments(ctx.tenantId, ctx.userId, parsed.data)
    after(() => sendPaymentConfirmations(ctx.tenantId, results.map((r) => r.paymentRecord)))
    if (nfse.documentIds.length > 0) after(() => processDocuments(nfse.documentIds))

    return NextResponse.json({ success: true, data: results, nfse })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.details && { details: error.details }) },
        { status: 409 },
      )
    }
    return handleApiError(error, request)
  }
}
