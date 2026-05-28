import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { recordFollowup } from '@/lib/followups'
import { recordFollowupSchema } from '@/validations/followup'

export async function POST(
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
    const parsed = recordFollowupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    let result
    try {
      result = await recordFollowup({
        tenantId: ctx.tenantId,
        contactedBy: ctx.userId,
        procedureRecordId,
        channel: parsed.data.channel,
        outcome: parsed.data.outcome,
        notes: parsed.data.notes,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'Procedure not found') {
        return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
      }
      throw err
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_followup',
      entityId: result.followupId,
      changes: {
        followup: {
          old: null,
          new: {
            procedureRecordId,
            channel: parsed.data.channel,
            outcome: parsed.data.outcome,
            notes: parsed.data.notes ?? null,
          },
        },
        ...(result.cancelledProcedure
          ? {
              status: { old: null, new: 'cancelled' },
              cancellationReason: { old: null, new: 'patient_declined' },
            }
          : {}),
      },
    })

    return NextResponse.json({ success: true, data: result })
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
