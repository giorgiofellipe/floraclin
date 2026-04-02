import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listFinancialEntries,
  createFinancialEntry,
} from '@/db/queries/financial'
import { financialFilterSchema, createFinancialEntrySchema } from '@/validations/financial'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    // Financial create: owner + receptionist + financial
    if (!['owner', 'receptionist', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    return NextResponse.json({ success: true, data: entry })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
