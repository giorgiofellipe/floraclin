import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { requireWrite } from '@/lib/write-access'
import {
  listFinancialEntries,
  createFinancialEntry,
  recordPayment,
} from '@/db/queries/financial'
import { financialFilterSchema, createFinancialEntrySchema } from '@/validations/financial'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { reportSideEffectFailure } from '@/lib/observability'

const PAYMENT_FAILED_MESSAGE = 'Não foi possível registrar o pagamento. A cobrança ficou pendente.'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Financial list: owner + financial + receptionist + practitioner (read)
    if (!['owner', 'financial', 'receptionist', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const filters = {
      patientId: searchParams.get('patientId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      isOverdue: searchParams.get('isOverdue') === 'true' ? true : undefined,
      isPartial: searchParams.get('isPartial') === 'true' ? true : undefined,
      paymentMethod: searchParams.get('paymentMethod') ?? undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    }

    const parsed = financialFilterSchema.safeParse(filters)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Filtros inválidos' }, { status: 400 })
    }

    const data = await listFinancialEntries(ctx.tenantId, parsed.data)
    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'receptionist', 'financial')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = createFinancialEntrySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const entry = await createFinancialEntry(ctx.tenantId, ctx.userId, parsed.data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'financial_entry',
      entityId: entry.id,
    })

    const { card, paymentMethod, totalAmount } = parsed.data
    let paymentError: string | undefined
    if (card && paymentMethod) {
      try {
        await recordPayment(ctx.tenantId, ctx.userId, {
          installmentId: entry.installmentIds[0],
          amount: totalAmount,
          paymentMethod,
          card,
          expectedTotalDue: totalAmount,
        })
      } catch (error) {
        if (error instanceof BusinessError) {
          paymentError = error.message
        } else {
          paymentError = PAYMENT_FAILED_MESSAGE
          reportSideEffectFailure(error, {
            area: 'financial',
            step: 'create-entry-card-payment',
            extra: { entryId: entry.id },
          })
        }
      }
    }

    return NextResponse.json({ success: true, data: entry, ...(paymentError && { paymentError }) }, { status: 201 })
  } catch (error) {
    return handleApiError(error, request)
  }
}
