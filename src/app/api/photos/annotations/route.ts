import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { saveAnnotation as saveAnnotationQuery } from '@/db/queries/photos'
import { saveAnnotationSchema } from '@/validations/photo'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Annotation save error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
