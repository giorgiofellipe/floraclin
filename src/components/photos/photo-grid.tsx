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
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils'
import { listPhotosAction, deletePhotoAction } from '@/actions/photos'
import type { PhotosByStage, PhotoAssetWithUrl } from '@/db/queries/photos'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoGridProps {
  patientId: string
  procedureRecordId?: string
  onAnnotate?: (photo: PhotoAssetWithUrl) => void
  refreshKey?: number
}

// ─── Component ──────────────────────────────────────────────────────

export function PhotoGrid({
  patientId,
  procedureRecordId,
  onAnnotate,
  refreshKey,
}: PhotoGridProps) {
  const [photosByStage, setPhotosByStage] = useState<PhotosByStage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoAssetWithUrl | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PhotoAssetWithUrl | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadPhotos = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listPhotosAction(patientId, procedureRecordId)
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
      const result = await deletePhotoAction(deleteTarget.id)
      if (result.success) {
        setDeleteTarget(null)
        await loadPhotos()
      }
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadPhotos])

  const stagesWithPhotos = photosByStage.filter((s) => s.photos.length > 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando fotos...</span>
      </div>
    )
  }

  if (stagesWithPhotos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <ZoomIn className="mb-2 size-8" />
        <p className="text-sm">Nenhuma foto encontrada</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {stagesWithPhotos.map((stageGroup) => (
          <div key={stageGroup.stage}>
            <h3 className="mb-3 text-sm font-medium text-foreground">
              {stageGroup.label}
              <span className="ml-2 text-xs text-muted-foreground">
                ({stageGroup.photos.length})
              </span>
            </h3>

            <div className="flex gap-3 overflow-x-auto pb-2">
              {stageGroup.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-muted/30 transition-shadow hover:shadow-md"
                  style={{ width: 160 }}
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
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        Erro ao carregar
                      </div>
                    )}
                  </div>

                  {/* Hover overlay with actions */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
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
                  <div className="space-y-0.5 px-2 py-1.5">
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(photo.createdAt)}
                    </p>
                    {photo.notes && (
                      <p className="truncate text-xs text-muted-foreground/70">
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedPhoto?.originalFilename ?? 'Foto'}
            </DialogTitle>
          </DialogHeader>
          {selectedPhoto?.signedUrl && (
            <div className="flex items-center justify-center">
              <img
                src={selectedPhoto.signedUrl}
                alt={selectedPhoto.originalFilename ?? 'Foto'}
                className="max-h-[70vh] rounded-lg object-contain"
              />
            </div>
          )}
          {selectedPhoto?.notes && (
            <p className="text-sm text-muted-foreground">{selectedPhoto.notes}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
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
