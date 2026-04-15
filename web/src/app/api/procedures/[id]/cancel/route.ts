import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getProcedure, cancelProcedure } from '@/db/queries/procedures'
import { financialEntries, installments } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '@/db/client'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
      const updated = await cancelProcedure(ctx.tenantId, procedureId, reason.trim(), tx)
      if (!updated) throw new Error('Falha ao cancelar procedimento')

      if (procedure.status === 'approved') {
        const cancelledEntries = await (tx as unknown as typeof db)
          .update(financialEntries)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(financialEntries.procedureRecordId, procedureId),
              eq(financialEntries.tenantId, ctx.tenantId),
              isNull(financialEntries.deletedAt)
            )
          )
          .returning({ id: financialEntries.id })

        for (const entry of cancelledEntries) {
          await (tx as unknown as typeof db)
            .update(installments)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(installments.financialEntryId, entry.id),
                eq(installments.tenantId, ctx.tenantId)
              )
            )
        }
      }

      return updated
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
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
