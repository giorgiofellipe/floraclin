'use server'

import { requireRole } from '@/lib/auth'
import { getStoragePath, uploadFile } from '@/lib/storage'
import { createAuditLog } from '@/lib/audit'
import {
  listPhotos as listPhotosQuery,
  createPhotoAsset,
  deletePhotoAsset,
  saveAnnotation as saveAnnotationQuery,
  getAnnotation as getAnnotationQuery,
  getComparisonUrls as getComparisonUrlsQuery,
} from '@/db/queries/photos'
import { uploadPhotoSchema, saveAnnotationSchema } from '@/validations/photo'

// ─── Types ──────────────────────────────────────────────────────────

export type PhotoActionResult = {
  success: boolean
  error?: string
  data?: unknown
}

// ─── Upload Photo ───────────────────────────────────────────────────

export async function uploadPhotoAction(formData: FormData): Promise<PhotoActionResult> {
  const context = await requireRole('owner', 'practitioner')

  const file = formData.get('file') as File | null
  if (!file || !(file instanceof File)) {
    return { success: false, error: 'Nenhum arquivo enviado' }
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
    return { success: false, error: firstError ?? 'Dados inválidos' }
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
    return { success: false, error: `Erro ao fazer upload: ${uploadError}` }
  }

  // Create photo asset record
  const photoAsset = await createPhotoAsset(context.tenantId, {
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

  await createAuditLog({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'create',
    entityType: 'photo_asset',
    entityId: photoAsset.id,
  })

  return { success: true, data: photoAsset }
}

// ─── List Photos ────────────────────────────────────────────────────

export async function listPhotosAction(
  patientId: string,
  procedureRecordId?: string
) {
  const context = await requireRole('owner', 'practitioner')
  const photosByStage = await listPhotosQuery(context.tenantId, patientId, procedureRecordId)
  return { success: true, data: photosByStage }
}

// ─── Delete Photo ───────────────────────────────────────────────────

export async function deletePhotoAction(photoId: string): Promise<PhotoActionResult> {
  const context = await requireRole('owner', 'practitioner')

  const deleted = await deletePhotoAsset(context.tenantId, photoId)
  if (!deleted) {
    return { success: false, error: 'Foto não encontrada' }
  }

  await createAuditLog({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'delete',
    entityType: 'photo_asset',
    entityId: photoId,
  })

  return { success: true }
}

// ─── Save Annotation ────────────────────────────────────────────────

export async function saveAnnotationAction(
  photoAssetId: string,
  annotationData: Record<string, unknown>
): Promise<PhotoActionResult> {
  const context = await requireRole('owner', 'practitioner')

  const parsed = saveAnnotationSchema.safeParse({ photoAssetId, annotationData })
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
    return { success: false, error: firstError ?? 'Dados inválidos' }
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

  return { success: true, data: annotation }
}

// ─── Get Annotation ─────────────────────────────────────────────────

export async function getAnnotationAction(photoAssetId: string) {
  const context = await requireRole('owner', 'practitioner')
  const annotation = await getAnnotationQuery(context.tenantId, photoAssetId)
  return { success: true, data: annotation }
}

// ─── Get Comparison URLs ────────────────────────────────────────────

export async function getComparisonUrlsAction(photoIdA: string, photoIdB: string) {
  const context = await requireRole('owner', 'practitioner')
  const urls = await getComparisonUrlsQuery(context.tenantId, photoIdA, photoIdB)
  return { success: true, data: urls }
}
