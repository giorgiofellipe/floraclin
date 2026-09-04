import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getInstallmentQuote } from '@/db/queries/financial-quote'
import { BusinessError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { paidAtField } from '@/validations/financial'

const querySchema = z.object({
  // Postgres raises on a malformed uuid, which would answer 500 and page
  // Discord for what is just a bad URL.
  installmentId: z.string().uuid('Parcela inválida'),
  paidAt: paidAtField,
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'receptionist', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const parsed = querySchema.safeParse({
      installmentId: id,
      paidAt: new URL(request.url).searchParams.get('paidAt') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const asOf = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date()
    const quote = await getInstallmentQuote(ctx.tenantId, id, asOf)

    return NextResponse.json({ success: true, data: quote })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
