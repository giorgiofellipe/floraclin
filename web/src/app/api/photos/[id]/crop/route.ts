import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { updateCropBox, getPhotoAsset } from '@/db/queries/photos'
import { saveCropSchema } from '@/validations/photo-crop'
import { handleApiError } from '@/lib/api-error'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
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

    const photo = await getPhotoAsset(ctx.tenantId, photoId)
    if (!photo) {
      return NextResponse.json(
        { success: false, error: 'Foto não encontrada' },
        { status: 404 },
      )
    }

    await updateCropBox(ctx.tenantId, photoId, parsed.data.cropBox ?? null)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno ao salvar recorte' } })
  }
}
