import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { deleteBlockById, getBlockById } from '@/db/queries/calendar'
import { handleApiError } from '@/lib/api-error'
import { canDeleteBlock } from '@/lib/calendar-blocks'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { id } = await params

    const block = await getBlockById(ctx.tenantId, id)
    if (!block) {
      return NextResponse.json({ error: 'Bloqueio não encontrado' }, { status: 404 })
    }
    if (block.source === 'google') {
      return NextResponse.json(
        { error: 'Bloqueio sincronizado do Google Agenda. Remova o evento no Google.' },
        { status: 409 },
      )
    }
    if (!canDeleteBlock(block, ctx.role, ctx.userId)) {
      return NextResponse.json({ error: 'Você só pode remover bloqueios da sua própria agenda' }, { status: 403 })
    }

    const deleted = await deleteBlockById(ctx.tenantId, id)
    if (!deleted) {
      return NextResponse.json({ error: 'Bloqueio não encontrado' }, { status: 404 })
    }
    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'calendar_block',
      entityId: id,
      changes: { block: { old: block, new: null } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
