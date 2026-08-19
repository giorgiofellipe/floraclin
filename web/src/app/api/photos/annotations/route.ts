import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { saveAnnotation as saveAnnotationQuery } from '@/db/queries/photos'
import { saveAnnotationSchema } from '@/validations/photo'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const context = await requireRole('owner', 'practitioner')

    const body = await request.json()
    const { photoAssetId, annotationData } = body

    const parsed = saveAnnotationSchema.safeParse({ photoAssetId, annotationData })
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      return NextResponse.json({ success: false, error: firstError ?? 'Dados invalidos' }, { status: 400 })
    }

    const annotation = await saveAnnotationQuery(
      context.tenantId,
      photoAssetId,
      context.userId,
      annotationData
    )

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: annotation ? 'update' : 'create',
      entityType: 'photo_annotation',
      entityId: annotation.id,
    })

    return NextResponse.json({ success: true, data: annotation })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno' } })
  }
}
