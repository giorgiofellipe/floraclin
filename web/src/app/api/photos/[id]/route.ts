import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { deletePhotoAsset } from '@/db/queries/photos'
import { handleApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { id: photoId } = await context.params

    const deleted = await deletePhotoAsset(ctx.tenantId, photoId)
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Foto não encontrada' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno ao deletar foto' } })
  }
}
