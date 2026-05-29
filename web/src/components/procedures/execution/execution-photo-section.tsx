'use client'

import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoGrid } from '@/components/photos/photo-grid'

interface Props {
  patientId: string
  procedureId: string
  photoRefreshKey: number
  onRefresh: () => void
  /**
   * Bubbles each successful upload's photo asset id up so the parent form can
   * include them in the session-create payload (server-side reassigns them to
   * the freshly created `procedure_session_id`).
   */
  onPhotoUploaded?: (assetId: string) => void
  stage: 'pre' | 'immediate_post'
  disabled?: boolean
}

export function ExecutionPhotoSection({
  patientId,
  procedureId,
  photoRefreshKey,
  onRefresh,
  onPhotoUploaded,
  stage,
  disabled,
}: Props) {
  return (
    <div className="space-y-4">
      {!disabled && (
        <PhotoUploader
          patientId={patientId}
          procedureRecordId={procedureId}
          defaultStage={stage}
          onUploadComplete={onRefresh}
          onUploaded={onPhotoUploaded}
        />
      )}
      <PhotoGrid
        patientId={patientId}
        procedureRecordId={procedureId}
        refreshKey={photoRefreshKey}
        timelineStage={stage}
      />
    </div>
  )
}
