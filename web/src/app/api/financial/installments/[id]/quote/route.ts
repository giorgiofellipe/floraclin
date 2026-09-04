import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getInstallmentQuote } from '@/db/queries/financial-quote'
import { BusinessError } from '@/lib/errors'
import { handleApiError } from '@/lib/api-error'
import { brToday, endOfBrDay } from '@/lib/dates'

const querySchema = z.object({
  paidAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() <= endOfBrDay(brToday()).getTime(), {
      message: 'Data do pagamento não pode ser no futuro',
    })
    .optional(),
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
