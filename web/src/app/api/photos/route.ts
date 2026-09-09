import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { getStoragePath, uploadFile } from '@/lib/storage'
import { createAuditLog } from '@/lib/audit'
import {
  listPhotos as listPhotosQuery,
  createPhotoAsset,
  getComparisonUrls as getComparisonUrlsQuery,
} from '@/db/queries/photos'
import { deleteFile } from '@/lib/storage'
import {
  uploadPhotoSchema,
  ACCEPTED_IMAGE_TYPES,
  isDngFile,
} from '@/validations/photo'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

// ─── Upload Photo ───────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    // Server-side file size guard (5MB max — client compresses to ~1-2MB typically)
    const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ success: false, error: 'Arquivo muito grande. Máximo 5MB.' }, { status: 413 })
    }

    // Server-side MIME validation — defense in depth. The client already runs
    // `validateImageFile`, but the API must not trust browser-supplied types
    // (e.g., curl with a forged `Content-Type: text/html` would otherwise let a
    // malicious file land in storage and later be served with the spoofed
    // content type). DNG is rejected here because the server can't decode it —
    // the client must convert to JPEG via libraw-wasm before upload.
    if (isDngFile(file)) {
      return NextResponse.json({ success: false, error: 'Formato DNG deve ser convertido para JPEG no navegador antes do upload' }, { status: 415 })
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
      return NextResponse.json({ success: false, error: 'Tipo de arquivo não suportado' }, { status: 415 })
    }

    // Validate metadata
    const parsed = uploadPhotoSchema.safeParse({
      patientId: formData.get('patientId'),
      procedureRecordId: formData.get('procedureRecordId') || undefined,
      procedureSessionId: formData.get('procedureSessionId') || undefined,
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
    const storagePath = getStoragePath(ctx.tenantId, patientId, filename)

    // Upload to Supabase Storage
    const { error: uploadError } = await uploadFile(storagePath, file)
    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError)
      return NextResponse.json({ success: false, error: 'Erro ao fazer upload da imagem' }, { status: 500 })
    }

    // Create photo asset record — if DB insert fails, clean up the uploaded file
    let photoAsset
    try {
      photoAsset = await createPhotoAsset(ctx.tenantId, {
        patientId,
        procedureRecordId,
        procedureSessionId: parsed.data.procedureSessionId ?? null,
        storagePath,
        originalFilename: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        timelineStage,
        uploadedBy: ctx.userId,
        notes,
      })
    } catch (dbError) {
      try {
        await deleteFile(storagePath)
      } catch (cleanupError) {
        // Both the insert and the cleanup failed, so a patient photo is now
        // orphaned in storage with no row pointing at it.
        reportSideEffectFailure(cleanupError, { area: 'photos', step: 'upload_cleanup' })
      }
      throw dbError
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'photo_asset',
      entityId: photoAsset.id,
    })

    return NextResponse.json({ success: true, data: photoAsset })
  } catch (error) {
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno ao fazer upload' } })
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
    return handleApiError(error, request, { body: { success: false, error: 'Erro interno' } })
  }
}
