import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { toggleProductActive } from '@/db/queries/products'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id } = await params
    const { isActive } = await request.json()

    const product = await toggleProductActive(ctx.tenantId, id, isActive)
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'product',
      entityId: id,
      changes: { isActive: { old: !isActive, new: isActive } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
