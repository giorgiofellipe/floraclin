'use client'

import { useState } from 'react'
import { PhotoGrid } from '@/components/photos/photo-grid'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoComparison } from '@/components/photos/photo-comparison'
import { Button } from '@/components/ui/button'
import { Upload, GitCompareArrows } from 'lucide-react'

interface PatientPhotosTabProps {
  patientId: string
}

export function PatientPhotosTab({ patientId }: PatientPhotosTabProps) {
  const [showUploader, setShowUploader] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">Fotos do paciente organizadas por estágio</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowComparison(!showComparison)}
          >
            <GitCompareArrows className="size-4 mr-1" />
            Comparar
          </Button>
          <Button onClick={() => setShowUploader(!showUploader)}>
            <Upload className="size-4 mr-1" />
            Enviar Fotos
          </Button>
        </div>
      </div>

      {showUploader && (
        <div className="rounded-lg border bg-white p-4">
          <PhotoUploader
            patientId={patientId}
            onUploadComplete={() => {
              setRefreshKey((k) => k + 1)
              setShowUploader(false)
            }}
          />
        </div>
      )}

      {showComparison && (
        <div className="rounded-lg border bg-white p-4">
          <PhotoComparison patientId={patientId} />
        </div>
      )}

      <PhotoGrid
        patientId={patientId}
        refreshKey={refreshKey}
      />
    </div>
  )
}
