import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { saveAnnotation as saveAnnotationQuery } from '@/db/queries/photos'
import { saveAnnotationSchema } from '@/validations/photo'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const body = await request.json()
    const { photoAssetId, annotationData } = body

    const parsed = saveAnnotationSchema.safeParse({ photoAssetId, annotationData })
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      return NextResponse.json({ success: false, error: firstError ?? 'Dados invalidos' }, { status: 400 })
    }

    const annotation = await saveAnnotationQuery(
      ctx.tenantId,
      photoAssetId,
      ctx.userId,
      annotationData
    )

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: annotation ? 'update' : 'create',
      entityType: 'photo_annotation',
      entityId: annotation.id,
    })

    return NextResponse.json({ success: true, data: annotation })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno' } })
  }
}
