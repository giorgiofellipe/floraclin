import { db } from '@/db/client'
import { photoAssets, photoAnnotations, patients, procedureRecords } from '@/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getSignedUrl, deleteFile } from '@/lib/storage'
import type { TimelineStage } from '@/types'
import { timelineStageValues } from '@/validations/photo'
import { verifyTenantOwnership } from './helpers'

// ─── Types ──────────────────────────────────────────────────────────

export interface PhotoAssetWithUrl {
  id: string
  storagePath: string
  originalFilename: string | null
  mimeType: string | null
  fileSizeBytes: number | null
  timelineStage: string | null
  takenAt: Date | null
  notes: string | null
  createdAt: Date
  signedUrl: string | null
}

export interface PhotosByStage {
  stage: TimelineStage
  label: string
  photos: PhotoAssetWithUrl[]
}

// ─── Queries ────────────────────────────────────────────────────────

export async function listPhotos(
  tenantId: string,
  patientId: string,
  procedureRecordId?: string
): Promise<PhotosByStage[]> {
  const conditions = [
    eq(photoAssets.tenantId, tenantId),
    eq(photoAssets.patientId, patientId),
    isNull(photoAssets.deletedAt),
  ]

  if (procedureRecordId) {
    conditions.push(eq(photoAssets.procedureRecordId, procedureRecordId))
  }

  const photos = await db
    .select()
    .from(photoAssets)
    .where(and(...conditions))
    .orderBy(desc(photoAssets.createdAt))

  // Generate signed URLs for all photos
  const photosWithUrls: PhotoAssetWithUrl[] = await Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      storagePath: photo.storagePath,
      originalFilename: photo.originalFilename,
      mimeType: photo.mimeType,
      fileSizeBytes: photo.fileSizeBytes,
      timelineStage: photo.timelineStage,
      takenAt: photo.takenAt,
      notes: photo.notes,
      createdAt: photo.createdAt,
      signedUrl: await getSignedUrl(photo.storagePath),
    }))
  )

  // Group by timeline stage
  const stageLabels: Record<TimelineStage, string> = {
    pre: 'Pré',
    immediate_post: 'Pós Imediato',
    '7d': '7 Dias',
    '30d': '30 Dias',
    '90d': '90 Dias',
    other: 'Outro',
  }

  return timelineStageValues.map((stage) => ({
    stage,
    label: stageLabels[stage],
    photos: photosWithUrls.filter((p) => p.timelineStage === stage),
  }))
}

export async function getPhotoAsset(tenantId: string, photoId: string) {
  const result = await db
    .select()
    .from(photoAssets)
    .where(
      and(
        eq(photoAssets.tenantId, tenantId),
        eq(photoAssets.id, photoId),
        isNull(photoAssets.deletedAt)
      )
    )
    .limit(1)

  return result[0] ?? null
}

export async function createPhotoAsset(
  tenantId: string,
  data: {
    patientId: string
    procedureRecordId?: string
    storagePath: string
    originalFilename?: string
    mimeType?: string
    fileSizeBytes?: number
    timelineStage: string
    uploadedBy: string
    notes?: string
  }
) {
  // Verify foreign IDs belong to this tenant
  await Promise.all([
    verifyTenantOwnership(tenantId, patients, data.patientId, 'Patient'),
    ...(data.procedureRecordId
      ? [verifyTenantOwnership(tenantId, procedureRecords, data.procedureRecordId, 'Procedure record')]
      : []),
  ])

  const [inserted] = await db
    .insert(photoAssets)
    .values({
      tenantId,
      patientId: data.patientId,
      procedureRecordId: data.procedureRecordId,
      storagePath: data.storagePath,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      fileSizeBytes: data.fileSizeBytes,
      timelineStage: data.timelineStage,
      uploadedBy: data.uploadedBy,
      notes: data.notes,
      takenAt: new Date(),
    })
    .returning()

  return inserted
}

export async function deletePhotoAsset(tenantId: string, photoId: string) {
  const photo = await getPhotoAsset(tenantId, photoId)
  if (!photo) return null

  // Soft delete the record
  const [deleted] = await db
    .update(photoAssets)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(photoAssets.tenantId, tenantId),
        eq(photoAssets.id, photoId)
      )
    )
    .returning()

  // Delete from storage — log warning if it fails but don't block the operation
  try {
    await deleteFile(photo.storagePath)
  } catch (storageError) {
    console.warn(
      `Failed to delete file from storage after soft-delete (photoId=${photoId}, path=${photo.storagePath}):`,
      storageError
    )
  }

  return deleted
}

// ─── Annotations ────────────────────────────────────────────────────

export async function getAnnotation(tenantId: string, photoAssetId: string) {
  const result = await db
    .select()
    .from(photoAnnotations)
    .where(
      and(
        eq(photoAnnotations.tenantId, tenantId),
        eq(photoAnnotations.photoAssetId, photoAssetId)
      )
    )
    .orderBy(desc(photoAnnotations.updatedAt))
    .limit(1)

  return result[0] ?? null
}

export async function saveAnnotation(
  tenantId: string,
  photoAssetId: string,
  userId: string,
  annotationData: Record<string, unknown>
) {
  const existing = await getAnnotation(tenantId, photoAssetId)

  if (existing) {
    const [updated] = await db
      .update(photoAnnotations)
      .set({
        annotationData,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(photoAnnotations.tenantId, tenantId),
          eq(photoAnnotations.id, existing.id)
        )
      )
      .returning()

    return updated
  }

  const [inserted] = await db
    .insert(photoAnnotations)
    .values({
      tenantId,
      photoAssetId,
      annotationData,
      createdBy: userId,
    })
    .returning()

  return inserted
}

// ─── Comparison helper ──────────────────────────────────────────────

export async function getComparisonUrls(
  tenantId: string,
  photoIdA: string,
  photoIdB: string
): Promise<{ urlA: string | null; urlB: string | null }> {
  const [photoA, photoB] = await Promise.all([
    getPhotoAsset(tenantId, photoIdA),
    getPhotoAsset(tenantId, photoIdB),
  ])

  const [urlA, urlB] = await Promise.all([
    photoA ? getSignedUrl(photoA.storagePath) : null,
    photoB ? getSignedUrl(photoB.storagePath) : null,
  ])

  return { urlA, urlB }
}
