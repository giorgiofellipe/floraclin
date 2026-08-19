import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { deletePhotoAsset } from '@/db/queries/photos'
import { handleApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireRole('owner', 'practitioner')
    const { id: photoId } = await context.params

    const deleted = await deletePhotoAsset(auth.tenantId, photoId)
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
