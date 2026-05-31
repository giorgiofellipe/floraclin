import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { deletePhotoAsset } from '@/db/queries/photos'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: Request, context: RouteContext) {
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo delete error:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao deletar foto' },
      { status: 500 },
    )
  }
}
