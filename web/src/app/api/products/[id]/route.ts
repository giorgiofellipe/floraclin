import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { getProduct, updateProduct, deleteProduct } from '@/db/queries/products'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id } = await params
    const body = await request.json()

    const existing = await getProduct(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    const product = await updateProduct(ctx.tenantId, id, body)
    if (!product) {
      return NextResponse.json({ error: 'Erro ao atualizar produto' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'product',
      entityId: id,
      changes: { product: { old: existing, new: body } },
    })

    return NextResponse.json({ success: true, data: product })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id } = await params
    const product = await deleteProduct(ctx.tenantId, id)
    if (!product) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'product',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
