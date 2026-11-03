import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getProcedure, cancelProcedure } from '@/db/queries/procedures'
import { cancelLinkedFinancials } from '@/db/queries/financial'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id: procedureId } = await params
    const body = await request.json()
    const reason = body.reason

    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 })
    }

    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
    }

    if (
      procedure.status !== 'draft' &&
      procedure.status !== 'planned' &&
      procedure.status !== 'approved'
    ) {
      return NextResponse.json({ error: 'Apenas procedimentos em rascunho, planejados ou aprovados podem ser cancelados' }, { status: 400 })
    }

    const result = await withTransaction(async (tx) => {
      const cancelled = await cancelProcedure(ctx.tenantId, procedureId, reason.trim(), tx)
      if (!cancelled) throw new Error('Falha ao cancelar procedimento')

      if (procedure.status === 'approved') {
        await cancelLinkedFinancials(tx, ctx.tenantId, ctx.userId, procedureId, reason.trim())
      }

      return cancelled
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureId,
      changes: {
        status: { old: procedure.status, new: 'cancelled' },
        cancellationReason: { old: null, new: reason.trim() },
        ...(result.releasedDiagramGroupIds.length > 0
          ? { releasedDiagramGroupIds: { old: null, new: result.releasedDiagramGroupIds } }
          : {}),
      },
    })

    return NextResponse.json({ success: true, data: result.procedure })
  } catch (error) {
    return handleApiError(error, request)
  }
}
