import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { deletePhotoAsset } from '@/db/queries/photos'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireRole('owner', 'practitioner')
    const { id } = await params

    const deleted = await deletePhotoAsset(context.tenantId, id)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Foto nao encontrada' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'delete',
      entityType: 'photo_asset',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo delete error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
