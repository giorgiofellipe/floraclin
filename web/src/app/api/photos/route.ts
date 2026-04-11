import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getStoragePath, uploadFile } from '@/lib/storage'
import { createAuditLog } from '@/lib/audit'
import {
  listPhotos as listPhotosQuery,
  createPhotoAsset,
  getComparisonUrls as getComparisonUrlsQuery,
} from '@/db/queries/photos'
import { deleteFile } from '@/lib/storage'
import { uploadPhotoSchema } from '@/validations/photo'

// ─── Upload Photo ───────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const context = await requireRole('owner', 'practitioner')

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    // Validate metadata
    const parsed = uploadPhotoSchema.safeParse({
      patientId: formData.get('patientId'),
      procedureRecordId: formData.get('procedureRecordId') || undefined,
      timelineStage: formData.get('timelineStage'),
      notes: formData.get('notes') || undefined,
    })

    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      return NextResponse.json({ success: false, error: firstError ?? 'Dados invalidos' }, { status: 400 })
    }

    const { patientId, procedureRecordId, timelineStage, notes } = parsed.data

    // Generate unique filename and storage path
    const fileId = crypto.randomUUID()
    const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg'
    const filename = `${fileId}.${extension}`
    const storagePath = getStoragePath(context.tenantId, patientId, filename)

    // Upload to Supabase Storage
    const { error: uploadError } = await uploadFile(storagePath, file)
    if (uploadError) {
      return NextResponse.json({ success: false, error: `Erro ao fazer upload: ${uploadError}` }, { status: 500 })
    }

    // Create photo asset record — if DB insert fails, clean up the uploaded file
    let photoAsset
    try {
      photoAsset = await createPhotoAsset(context.tenantId, {
        patientId,
        procedureRecordId,
        storagePath,
        originalFilename: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        timelineStage,
        uploadedBy: context.userId,
        notes,
      })
    } catch (dbError) {
      try {
        await deleteFile(storagePath)
      } catch (cleanupError) {
        console.error('Failed to clean up uploaded file after DB error:', cleanupError)
      }
      throw dbError
    }

    await createAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'create',
      entityType: 'photo_asset',
      entityId: photoAsset.id,
    })

    return NextResponse.json({ success: true, data: photoAsset })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo upload error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno ao fazer upload' }, { status: 500 })
  }
}

// ─── List Photos ────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const context = await requireRole('owner', 'practitioner')

    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')
    const procedureRecordId = searchParams.get('procedureRecordId') || undefined
    const photoIdA = searchParams.get('photoIdA')
    const photoIdB = searchParams.get('photoIdB')

    // Comparison URLs mode
    if (photoIdA && photoIdB) {
      const urls = await getComparisonUrlsQuery(context.tenantId, photoIdA, photoIdB)
      return NextResponse.json({ success: true, data: urls })
    }

    if (!patientId) {
      return NextResponse.json({ success: false, error: 'patientId is required' }, { status: 400 })
    }

    const photosByStage = await listPhotosQuery(context.tenantId, patientId, procedureRecordId)
    return NextResponse.json({ success: true, data: photosByStage })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Photo list error:', error)
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 })
  }
}
