import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { snoozeProcedure } from '@/lib/followups'
import { snoozeSchema } from '@/validations/followup'
import { parseBrDate, brToday } from '@/lib/dates'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: procedureRecordId } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = snoozeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    if (parsed.data.until !== null) {
      // Validate that the YYYY-MM-DD is a real date (parseBrDate throws on bad inputs
      // and additionally rejects logical out-of-range values via date-fns-tz). Then
      // require until > today so a snooze actually defers the row.
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

    const ok = await snoozeProcedure({
      tenantId: ctx.tenantId,
      procedureRecordId,
      until: parsed.data.until,
    })

    if (!ok) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureRecordId,
      changes: {
        followupSnoozedUntil: { old: null, new: parsed.data.until },
      },
    })

    return NextResponse.json({ success: true, data: { snoozedUntil: parsed.data.until } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
