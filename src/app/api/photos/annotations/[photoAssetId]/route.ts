import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getAnnotation as getAnnotationQuery } from '@/db/queries/photos'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ photoAssetId: string }> }
) {
  try {
    const context = await requireRole('owner', 'practitioner')
    const { photoAssetId } = await params

    const annotation = await getAnnotationQuery(context.tenantId, photoAssetId)
    return NextResponse.json({ success: true, data: annotation })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Annotation get error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
