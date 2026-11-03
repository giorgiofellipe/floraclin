import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { DIAGRAM_NOT_AWAITING, DIAGRAM_NOT_FOUND, snoozeDiagramGroup } from '@/lib/followups'
import { snoozeSchema } from '@/validations/followup'
import { parseBrDate, brToday } from '@/lib/dates'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id: groupId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = snoozeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    if (parsed.data.until !== null) {
      let parsedUntil: Date
      try {
        parsedUntil = parseBrDate(parsed.data.until, '12:00:00')
      } catch {
        return NextResponse.json({ error: 'Data inválida' }, { status: 400 })
      }
      const todayInstant = parseBrDate(brToday(), '12:00:00')
      if (parsedUntil.getTime() <= todayInstant.getTime()) {
        return NextResponse.json(
          { error: 'A data do snooze deve ser posterior a hoje' },
          { status: 400 },
        )
      }
    }

    try {
      await snoozeDiagramGroup({
        tenantId: ctx.tenantId,
        groupId,
        userId: ctx.userId,
        until: parsed.data.until,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === DIAGRAM_NOT_FOUND) {
        return NextResponse.json({ error: 'Orçamento não encontrado' }, { status: 404 })
      }
      if (msg === DIAGRAM_NOT_AWAITING) {
        return NextResponse.json({ error: 'Este orçamento não está mais aguardando' }, { status: 409 })
      }
      throw err
    }

    return NextResponse.json({ success: true, data: { snoozedUntil: parsed.data.until } })
  } catch (error) {
    return handleApiError(error, request)
  }
}
