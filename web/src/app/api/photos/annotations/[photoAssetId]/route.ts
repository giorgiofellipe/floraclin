import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getAnnotation as getAnnotationQuery } from '@/db/queries/photos'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoAssetId: string }> }
) {
  try {
    const context = await requireRole('owner', 'practitioner')
    const { photoAssetId } = await params

    const annotation = await getAnnotationQuery(context.tenantId, photoAssetId)
    return NextResponse.json({ success: true, data: annotation })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno' } })
  }
}
