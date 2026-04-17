'use client'

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trash2, ZoomIn, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils'
import type { PhotosByStage, PhotoAssetWithUrl } from '@/db/queries/photos'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoGridProps {
  patientId: string
  procedureRecordId?: string
  onAnnotate?: (photo: PhotoAssetWithUrl) => void
  refreshKey?: number
  timelineStage?: string
}

// ─── Component ──────────────────────────────────────────────────────

export function PhotoGrid({
  patientId,
  procedureRecordId,
  onAnnotate,
  refreshKey,
  timelineStage,
}: PhotoGridProps) {
  const [photosByStage, setPhotosByStage] = useState<PhotosByStage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoAssetWithUrl | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PhotoAssetWithUrl | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadPhotos = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ patientId })
      if (procedureRecordId) params.set('procedureRecordId', procedureRecordId)
      const res = await fetch(`/api/photos?${params}`)
      const result = await res.json()
      if (result.success && result.data) {
        setPhotosByStage(result.data)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId, procedureRecordId])

  useEffect(() => {
    loadPhotos()
  }, [loadPhotos, refreshKey])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/photos/${deleteTarget.id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.success) {
        setDeleteTarget(null)
        await loadPhotos()
      }
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadPhotos])

  const stagesWithPhotos = photosByStage
    .filter((s) => s.photos.length > 0)
    .filter((s) => !timelineStage || s.stage === timelineStage)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-sage" />
        <span className="ml-2 text-sm text-mid">Carregando fotos...</span>
      </div>
    )
  }

  if (stagesWithPhotos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-mid">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-white">
          <ZoomIn className="size-5 text-mid/60" />
        </div>
        <p className="text-sm">Nenhuma foto enviada.</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-8">
        {stagesWithPhotos.map((stageGroup) => (
          <div key={stageGroup.stage}>
            <div className="mb-3 flex items-center gap-2">
              <Badge className="bg-sage/10 text-sage border-0 px-2.5 py-0.5 text-xs font-medium">
                {stageGroup.label}
              </Badge>
              <span className="text-xs text-mid">
                {stageGroup.photos.length} {stageGroup.photos.length === 1 ? 'foto' : 'fotos'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {stageGroup.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative cursor-pointer overflow-hidden rounded-[3px] border-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors duration-200"
                >
                  <div className="aspect-square">
                    {photo.signedUrl ? (
                      <img
                        src={photo.signedUrl}
                        alt={photo.originalFilename ?? 'Foto'}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-mid/60 text-xs">
                        Erro ao carregar
                      </div>
                    )}
                  </div>

                  {/* Hover overlay with actions */}
                  <div className="absolute inset-0 flex items-end justify-center gap-2 bg-gradient-to-t from-black/50 to-transparent pb-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-white hover:bg-white/20 hover:text-white"
                      onClick={() => setSelectedPhoto(photo)}
                    >
                      <ZoomIn className="size-4" />
                    </Button>
                    {onAnnotate && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-white hover:bg-white/20 hover:text-white"
                        onClick={() => onAnnotate(photo)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-red-300 hover:bg-white/20 hover:text-red-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(photo)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {/* Info */}
                  <div className="space-y-0.5 px-2.5 py-2">
                    <p className="truncate text-xs text-mid">
                      {formatDateTime(photo.createdAt)}
                    </p>
                    {photo.notes && (
                      <p className="truncate text-xs text-mid/60">
                        {photo.notes}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Full-size view dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={(open) => !open && setSelectedPhoto(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedPhoto?.originalFilename ?? 'Foto'}
            </DialogTitle>
          </DialogHeader>
          {selectedPhoto?.signedUrl && (
            <div className="flex items-center justify-center rounded-[3px] overflow-hidden bg-charcoal/5">
              <img
                src={selectedPhoto.signedUrl}
                alt={selectedPhoto.originalFilename ?? 'Foto'}
                className="max-h-[70vh] rounded-lg object-contain"
              />
            </div>
          )}
          {selectedPhoto?.notes && (
            <p className="text-sm text-mid">{selectedPhoto.notes}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir foto</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir esta foto? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
