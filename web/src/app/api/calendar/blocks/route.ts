import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { BusinessError } from '@/lib/errors'
import { createManualBlock, listBlocksForDateRange } from '@/db/queries/calendar'
import { createCalendarBlockSchema } from '@/validations/calendar-block'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const practitionerId = searchParams.get('practitionerId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? ''
    const dateTo = searchParams.get('dateTo') ?? ''

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
    }

    const data = await listBlocksForDateRange(ctx.tenantId, practitionerId, dateFrom, dateTo)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const parsed = createCalendarBlockSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parsed.data

    if (ctx.role === 'practitioner' && data.practitionerId !== ctx.userId) {
      return NextResponse.json({ error: 'Você só pode bloquear a sua própria agenda' }, { status: 403 })
    }

    const input = {
      practitionerId: data.practitionerId,
      title: data.title || null,
      date: data.date,
      startTime: data.allDay ? null : data.startTime!,
      endTime: data.allDay ? null : data.endTime!,
      allDay: data.allDay,
    }
    const block = await createManualBlock(ctx.tenantId, input)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'calendar_block',
      entityId: block.id,
      changes: { block: { old: null, new: { id: block.id, ...input } } },
    })

    return NextResponse.json({ data: block }, { status: 201 })
  } catch (error) {
    if (error instanceof BusinessError && error.code === 'PRACTITIONER_NOT_FOUND') {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    }
    return handleApiError(error, request)
  }
}
