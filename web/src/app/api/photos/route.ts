import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { getStoragePath, uploadFile } from '@/lib/storage'
import { createAuditLog } from '@/lib/audit'
import {
  listPhotos as listPhotosQuery,
  createPhotoAsset,
  getComparisonUrls as getComparisonUrlsQuery,
} from '@/db/queries/photos'
import { db } from '@/db/client'
import { photoAssets } from '@/db/schema'
import { deleteFile } from '@/lib/storage'
import { uploadPhotoSchema, cropBoxSchema } from '@/validations/photo'

// ─── Upload Photo ───────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const context = await requireRole('owner', 'practitioner')

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

    // Optional crop fields — front end sends cropBox and cropAspect together
    // (it has the loaded image dimensions, so the server does not need sharp).
    let cropBox: import('@/validations/photo').CropBox | undefined
    let cropAspect: number | undefined
    const rawCropBox = formData.get('cropBox')
    const rawCropAspect = formData.get('cropAspect')
    if (rawCropBox) {
      try {
        const parsedCrop = cropBoxSchema.safeParse(JSON.parse(String(rawCropBox)))
        if (!parsedCrop.success) {
          return NextResponse.json({ success: false, error: 'cropBox inválido' }, { status: 400 })
        }
        cropBox = parsedCrop.data
      } catch {
        return NextResponse.json({ success: false, error: 'cropBox inválido' }, { status: 400 })
      }
      if (rawCropAspect == null) {
        return NextResponse.json({ success: false, error: 'cropAspect obrigatório quando cropBox é enviado' }, { status: 400 })
      }
      const aspectNum = Number(rawCropAspect)
      if (!Number.isFinite(aspectNum) || aspectNum <= 0) {
        return NextResponse.json({ success: false, error: 'cropAspect inválido' }, { status: 400 })
      }
      cropAspect = aspectNum
    }

    // Generate unique filename and storage path
    const fileId = crypto.randomUUID()
    const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg'
    const filename = `${fileId}.${extension}`
    const storagePath = getStoragePath(context.tenantId, patientId, filename)

    // Upload to Supabase Storage
    const { error: uploadError } = await uploadFile(storagePath, file)
    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError)
      return NextResponse.json({ success: false, error: 'Erro ao fazer upload da imagem' }, { status: 500 })
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

      // Persist the optional crop fields, if provided. Done as a follow-up update
      // so we keep the existing createPhotoAsset signature untouched.
      if (cropBox && cropAspect != null) {
        const [updated] = await db
          .update(photoAssets)
          .set({ cropBox, cropAspect: cropAspect.toString() })
          .where(
            and(
              eq(photoAssets.tenantId, context.tenantId),
              eq(photoAssets.id, photoAsset.id),
            ),
          )
          .returning()
        if (updated) photoAsset = updated
      }
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
