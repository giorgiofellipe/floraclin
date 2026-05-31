import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { updateCropBox, getPhotoAsset } from '@/db/queries/photos'
import { saveCropSchema } from '@/validations/photo-crop'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireRole('owner', 'practitioner')
    const { id: photoId } = await context.params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Corpo da requisição inválido' },
        { status: 400 },
      )
    }
    const parsed = saveCropSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      return NextResponse.json(
        { success: false, error: firstError ?? 'Dados de recorte inválidos' },
        { status: 400 },
      )
    }

    const photo = await getPhotoAsset(auth.tenantId, photoId)
    if (!photo) {
      return NextResponse.json(
        { success: false, error: 'Foto não encontrada' },
        { status: 404 },
      )
    }

    await updateCropBox(auth.tenantId, photoId, parsed.data.cropBox ?? null)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Crop update error:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao salvar recorte' },
      { status: 500 },
    )
  }
}
