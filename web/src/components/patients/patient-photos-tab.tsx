'use client'

import { useCallback, useState } from 'react'
import { PhotoGrid } from '@/components/photos/photo-grid'
import { PhotoUploadModal } from '@/components/photos/photo-upload-modal'
import { PhotoComparisonDialog } from '@/components/photos/photo-comparison'
import { PhotoAnnotationEditor } from '@/components/photos/photo-annotation-editor'
import { Button } from '@/components/ui/button'
import { Upload, GitCompareArrows, X, Camera } from 'lucide-react'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'

interface PatientPhotosTabProps {
  patientId: string
}

export function PatientPhotosTab({ patientId }: PatientPhotosTabProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [comparisonMode, setComparisonMode] = useState(false)
  const [selectedA, setSelectedA] = useState<PhotoAssetWithUrl | null>(null)
  const [selectedB, setSelectedB] = useState<PhotoAssetWithUrl | null>(null)
  const [showComparison, setShowComparison] = useState(false)
  const [annotatingPhoto, setAnnotatingPhoto] = useState<PhotoAssetWithUrl | null>(null)
  const [uploadModalTab, setUploadModalTab] = useState<'upload' | 'capture' | null>(null)

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
      <PhotoGrid
        patientId={patientId}
        refreshKey={refreshKey}
        comparisonMode={comparisonMode}
        selectedA={selectedA?.id ?? null}
        selectedB={selectedB?.id ?? null}
        onPhotoSelect={handlePhotoSelect}
        onAnnotate={setAnnotatingPhoto}
      />

      <PhotoAnnotationEditor
        photo={annotatingPhoto}
        patientId={patientId}
        open={!!annotatingPhoto}
        onOpenChange={(open) => {
          if (!open) {
            setAnnotatingPhoto(null)
            setRefreshKey((k) => k + 1)
          }
        }}
      />

      <PhotoComparisonDialog
        open={showComparison}
        onOpenChange={(open) => {
          setShowComparison(open)
        }}
        photoA={selectedA}
        photoB={selectedB}
      />

      <PhotoUploadModal
        key={uploadModalTab}
        open={uploadModalTab !== null}
        onOpenChange={(open) => {
          if (!open) setUploadModalTab(null)
        }}
        patientId={patientId}
        defaultTab={uploadModalTab ?? 'upload'}
        onComplete={() => {
          setRefreshKey((k) => k + 1)
        }}
      />

      {/* Floating action bar */}
      <div className="sticky bottom-0 z-30 !mt-0 -mx-6 -mb-6 border-t bg-white/95 backdrop-blur-sm shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
        {comparisonMode && (
          <div className="flex items-center justify-center gap-2 border-b px-4 py-2 text-sm text-[#4A6B52]">
            <GitCompareArrows className="size-3.5 shrink-0" />
            <span>
              {!selectedA
                ? 'Toque na primeira foto para comparar'
                : !selectedB
                  ? 'Agora toque na segunda foto'
                  : 'Fotos selecionadas — toque para trocar'}
            </span>
            {selectedA && selectedB && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-1 text-[#4A6B52] hover:bg-[#4A6B52]/10 text-xs"
                onClick={() => setShowComparison(true)}
              >
                Ver comparação
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center justify-center gap-2 px-4 py-3">
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
          <Button variant="outline" onClick={() => setUploadModalTab('capture')}>
            <Camera className="size-4 mr-1" />
            Capturar
          </Button>
          <Button onClick={() => setUploadModalTab('upload')}>
            <Upload className="size-4 mr-1" />
            Enviar
          </Button>
        </div>
      </div>
    </div>
  )
}
