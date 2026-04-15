'use client'

import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoGrid } from '@/components/photos/photo-grid'

interface Props {
  patientId: string
  procedureId: string
  photoRefreshKey: number
  onRefresh: () => void
  stage: 'pre' | 'immediate_post'
  disabled?: boolean
}

export function ExecutionPhotoSection({
  patientId,
  procedureId,
  photoRefreshKey,
  onRefresh,
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
