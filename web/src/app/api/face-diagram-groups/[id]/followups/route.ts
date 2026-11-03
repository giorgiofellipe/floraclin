import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import {
  DIAGRAM_NOT_AWAITING,
  DIAGRAM_NOT_FOUND,
  recordDiagramFollowup,
} from '@/lib/followups'
import { recordFollowupSchema } from '@/validations/followup'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner', 'receptionist')
    if (blocked) return blocked

    const { id: groupId } = await params
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
      result = await recordDiagramFollowup({
        tenantId: ctx.tenantId,
        groupId,
        userId: ctx.userId,
        channel: parsed.data.channel,
        outcome: parsed.data.outcome,
        notes: parsed.data.notes,
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

    return NextResponse.json({
      success: true,
      data: { followupId: result.followupId, cancelledProcedure: result.declined },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}
