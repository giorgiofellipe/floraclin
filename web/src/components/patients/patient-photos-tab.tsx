'use client'

import { useCallback, useState } from 'react'
import { PhotoGrid } from '@/components/photos/photo-grid'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { PhotoComparisonDialog } from '@/components/photos/photo-comparison'
import { Button } from '@/components/ui/button'
import { Upload, GitCompareArrows, X } from 'lucide-react'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'

interface PatientPhotosTabProps {
  patientId: string
}

export function PatientPhotosTab({ patientId }: PatientPhotosTabProps) {
  const [showUploader, setShowUploader] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [comparisonMode, setComparisonMode] = useState(false)
  const [selectedA, setSelectedA] = useState<PhotoAssetWithUrl | null>(null)
  const [selectedB, setSelectedB] = useState<PhotoAssetWithUrl | null>(null)
  const [showComparison, setShowComparison] = useState(false)

  const handlePhotoSelect = useCallback((photo: PhotoAssetWithUrl) => {
    if (selectedA?.id === photo.id) {
      setSelectedA(selectedB)
      setSelectedB(null)
      return
    }
    if (selectedB?.id === photo.id) {
      setSelectedB(null)
      return
    }
    if (!selectedA) {
      setSelectedA(photo)
      return
    }
    setSelectedB(photo)
    setShowComparison(true)
  }, [selectedA, selectedB])

  function exitComparison() {
    setComparisonMode(false)
    setSelectedA(null)
    setSelectedB(null)
    setShowComparison(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">Fotos do paciente organizadas por procedimento</p>
        <div className="flex gap-2">
          {comparisonMode ? (
            <Button variant="outline" onClick={exitComparison}>
              <X className="size-4 mr-1" />
              Sair da comparação
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setComparisonMode(true)}
            >
              <GitCompareArrows className="size-4 mr-1" />
              Comparar
            </Button>
          )}
          <Button onClick={() => setShowUploader(!showUploader)}>
            <Upload className="size-4 mr-1" />
            Enviar Fotos
          </Button>
        </div>
      </div>

      {comparisonMode && (
        <div className="flex items-center gap-3 rounded-lg bg-[#4A6B52] px-4 py-2.5 text-white">
          <GitCompareArrows className="size-4 shrink-0" />
          <p className="text-sm">
            {!selectedA
              ? 'Toque na primeira foto para comparar'
              : !selectedB
                ? 'Agora toque na segunda foto'
                : 'Fotos selecionadas — toque para trocar'}
          </p>
          {selectedA && selectedB && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-white hover:bg-white/15 hover:text-white text-xs"
              onClick={() => setShowComparison(true)}
            >
              Ver comparação
            </Button>
          )}
        </div>
      )}

      {showUploader && (
        <div className="rounded-[3px] border bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <PhotoUploader
            patientId={patientId}
            onUploadComplete={() => {
              setRefreshKey((k) => k + 1)
              setShowUploader(false)
            }}
          />
        </div>
      )}

      <PhotoGrid
        patientId={patientId}
        refreshKey={refreshKey}
        comparisonMode={comparisonMode}
        selectedA={selectedA?.id ?? null}
        selectedB={selectedB?.id ?? null}
        onPhotoSelect={handlePhotoSelect}
      />

      <PhotoComparisonDialog
        open={showComparison}
        onOpenChange={(open) => {
          setShowComparison(open)
        }}
        photoA={selectedA}
        photoB={selectedB}
      />
    </div>
  )
}
