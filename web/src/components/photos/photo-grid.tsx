'use client'

import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Trash2, ZoomIn, Pencil, Loader2, Crop as CropIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, formatDateTime, formatDate } from '@/lib/utils'
import type { PhotosByStage, PhotoAssetWithUrl } from '@/db/queries/photos'
import type { CropBox } from '@/validations/photo'
import { applyCropCover } from '@/lib/photos'
import { ImageCropperDialog } from './image-cropper'
import { useUpdatePhotoCrop } from '@/hooks/queries/use-photo-crop'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoGridProps {
  patientId: string
  procedureRecordId?: string
  onAnnotate?: (photo: PhotoAssetWithUrl) => void
  refreshKey?: number
  timelineStage?: string
  comparisonMode?: boolean
  selectedA?: string | null
  selectedB?: string | null
  onPhotoSelect?: (photo: PhotoAssetWithUrl) => void
}

// ─── Component ──────────────────────────────────────────────────────

export function PhotoGrid({
  patientId,
  procedureRecordId,
  onAnnotate,
  refreshKey,
  timelineStage,
  comparisonMode = false,
  selectedA,
  selectedB,
  onPhotoSelect,
}: PhotoGridProps) {
  const [photosByStage, setPhotosByStage] = useState<PhotosByStage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoAssetWithUrl | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PhotoAssetWithUrl | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Crop state. `listPhotos` returns the persisted `cropBox`/`cropAspect`
  // directly on each photo, but we layer a session-local override map keyed
  // by photo id on top of it so saves render immediately without waiting for
  // the photos query to refetch. Per-photo natural aspect is measured lazily
  // from the rendered <img>'s naturalWidth/naturalHeight as a fallback for
  // old rows that don't have `cropAspect` yet.
  const [cropTarget, setCropTarget] = useState<PhotoAssetWithUrl | null>(null)
  const [cropOverrides, setCropOverrides] = useState<
    Record<string, { cropBox: CropBox | null; sourceAspect: number }>
  >({})
  const [photoAspects, setPhotoAspects] = useState<Record<string, number>>({})

  const updateCrop = useUpdatePhotoCrop()

  const handleImageLoaded = useCallback(
    (photoId: string, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (img.naturalHeight <= 0) return
      const aspect = img.naturalWidth / img.naturalHeight
      setPhotoAspects((prev) => (prev[photoId] ? prev : { ...prev, [photoId]: aspect }))
    },
    [],
  )

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

  const handleSaveCrop = useCallback(
    async (photo: PhotoAssetWithUrl, box: CropBox | null) => {
      // Prefer the persisted aspect on the photo (set the first time the user
      // saved a crop) over a fresh measurement, since the measurement only
      // runs after the image has loaded inside the grid.
      const sourceAspect =
        photo.cropAspect ?? photoAspects[photo.id] ?? 1
      try {
        await updateCrop.mutateAsync({
          photoId: photo.id,
          cropBox: box,
          cropAspect: box ? sourceAspect : null,
        })
        setCropOverrides((prev) => ({
          ...prev,
          [photo.id]: { cropBox: box, sourceAspect },
        }))
        setCropTarget(null)
        toast.success(box ? 'Recorte salvo.' : 'Recorte removido.')
        // The photos query isn't wired through React Query here, so the
        // hook's invalidate is a no-op for this view — refetch by hand so
        // subsequent reads see the persisted state and the override map can
        // age out naturally.
        await loadPhotos()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao salvar recorte.')
      }
    },
    [loadPhotos, photoAspects, updateCrop],
  )

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

  const allPhotos = stagesWithPhotos.flatMap((s) => s.photos)
  const showProcedureGrouping = !procedureRecordId && allPhotos.length > 0

  const procedureGroups = React.useMemo(() => {
    if (!showProcedureGrouping) return []

    const grouped = new Map<string | null, PhotoAssetWithUrl[]>()
    for (const photo of allPhotos) {
      const key = photo.procedureRecordId ?? null
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(photo)
    }

    type ProcGroup = {
      procedureRecordId: string | null
      procedureTypeName: string | null
      procedurePerformedAt: Date | null
      photos: PhotoAssetWithUrl[]
      sortDate: number
    }

    const groups: ProcGroup[] = []
    for (const [key, photos] of grouped) {
      const first = photos[0]
      groups.push({
        procedureRecordId: key,
        procedureTypeName: key ? first.procedureTypeName : null,
        procedurePerformedAt: key ? first.procedurePerformedAt : null,
        photos,
        sortDate: key && first.procedurePerformedAt
          ? new Date(first.procedurePerformedAt).getTime()
          : Math.max(...photos.map((p) => new Date(p.createdAt).getTime())),
      })
    }

    groups.sort((a, b) => b.sortDate - a.sortDate)
    return groups
  }, [showProcedureGrouping, allPhotos])

  const stageLabels: Record<string, string> = {
    pre: 'Pré',
    immediate_post: 'Pós Imediato',
    '7d': '7 Dias',
    '30d': '30 Dias',
    '90d': '90 Dias',
    other: 'Outro',
  }

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

  function renderPhotoCard(photo: PhotoAssetWithUrl) {
    const isA = comparisonMode && selectedA === photo.id
    const isB = comparisonMode && selectedB === photo.id
    const isSelected = isA || isB

    // Effective crop = optimistic override ?? persisted ?? null.
    const override = cropOverrides[photo.id]
    const effectiveCropBox = override ? override.cropBox : photo.cropBox
    const effectiveAspect =
      override?.sourceAspect ?? photo.cropAspect ?? photoAspects[photo.id]
    const cropStyle =
      effectiveCropBox && effectiveAspect
        ? applyCropCover(effectiveCropBox, effectiveAspect)
        : null

    return (
      <div
        key={photo.id}
        className={cn(
          'group overflow-hidden rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-all duration-200',
          isA && 'ring-3 ring-[#4A6B52]',
          isB && 'ring-3 ring-[#D4845A]',
          comparisonMode && 'cursor-pointer',
        )}
        onClick={comparisonMode && onPhotoSelect ? () => onPhotoSelect(photo) : undefined}
      >
        <div className="relative aspect-[3/4] overflow-hidden">
          {photo.signedUrl ? (
            cropStyle ? (
              // Object-cover variant: the wrapper is absolutely positioned
              // and sized to at LEAST the card's dimensions so the crop
              // fills the card uniformly (overflow clipped). Do not set
              // h-full w-full here — that would override the wrapper's
              // aspect-ratio rule.
              <div className="overflow-hidden" style={cropStyle.wrapperStyle}>
                <img
                  src={photo.signedUrl}
                  alt={photo.originalFilename ?? 'Foto'}
                  className="block"
                  style={cropStyle.imageStyle}
                  loading="lazy"
                  onLoad={(e) => handleImageLoaded(photo.id, e)}
                />
              </div>
            ) : (
              <img
                src={photo.signedUrl}
                alt={photo.originalFilename ?? 'Foto'}
                className="h-full w-full object-cover"
                loading="lazy"
                onLoad={(e) => handleImageLoaded(photo.id, e)}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-mid/60 text-xs">
              Erro ao carregar
            </div>
          )}

          {/* Selection badge in comparison mode */}
          {isSelected && (
            <div
              className={cn(
                'absolute top-1.5 left-1.5 z-10 flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-md',
                isA ? 'bg-[#4A6B52]' : 'bg-[#D4845A]',
              )}
            >
              {isA ? 'A' : 'B'}
            </div>
          )}
        </div>

        {/* Info + actions footer */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="truncate text-[11px] text-mid">
            {formatDateTime(photo.createdAt)}
          </p>
          {!comparisonMode && (
            <TooltipProvider delay={300}>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-9 text-mid hover:text-charcoal"
                      onClick={() => setSelectedPhoto(photo)}
                    >
                      <ZoomIn className="size-4" />
                    </Button>
                  } />
                  <TooltipContent side="top"><p>Ampliar</p></TooltipContent>
                </Tooltip>
                {photo.signedUrl && (
                  <Tooltip>
                    <TooltipTrigger render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-9 text-mid hover:text-charcoal"
                        onClick={() => setCropTarget(photo)}
                      >
                        <CropIcon className="size-4" />
                      </Button>
                    } />
                    <TooltipContent side="top"><p>Recortar</p></TooltipContent>
                  </Tooltip>
                )}
                {onAnnotate && (
                  <Tooltip>
                    <TooltipTrigger render={
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-9 text-mid hover:text-charcoal"
                          onClick={() => onAnnotate(photo)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {photo.hasAnnotation && (
                          <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-amber" />
                        )}
                      </div>
                    } />
                    <TooltipContent side="top"><p>Desenhar</p></TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-9 text-mid hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(photo)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  } />
                  <TooltipContent side="top"><p>Excluir</p></TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}
        </div>
      </div>
    )
  }

  function renderByDay(photos: PhotoAssetWithUrl[]) {
    const byDay = new Map<string, PhotoAssetWithUrl[]>()
    for (const photo of photos) {
      const day = formatDate(photo.createdAt)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(photo)
    }

    return Array.from(byDay.entries()).map(([day, dayPhotos]) => (
      <div key={day}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-medium text-mid">{day}</span>
          <span className="text-xs text-mid/60">
            {dayPhotos.length} {dayPhotos.length === 1 ? 'foto' : 'fotos'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {dayPhotos.map(renderPhotoCard)}
        </div>
      </div>
    ))
  }

  function renderStageGroup(photos: PhotoAssetWithUrl[], stage: string, label: string) {
    const stagePhotos = photos.filter((p) => p.timelineStage === stage)
    if (stagePhotos.length === 0) return null
    return (
      <div key={stage}>
        <div className="mb-3 flex items-center gap-2">
          <Badge className="bg-sage/10 text-sage border-0 px-2.5 py-0.5 text-xs font-medium">
            {label}
          </Badge>
          <span className="text-xs text-mid">
            {stagePhotos.length} {stagePhotos.length === 1 ? 'foto' : 'fotos'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {stagePhotos.map(renderPhotoCard)}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {showProcedureGrouping ? (
          procedureGroups.map((group) => (
            <div key={group.procedureRecordId ?? 'orphan'} className="relative">
              {/* Timeline left border */}
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-sage/30" aria-hidden="true" />

              {/* Header with timeline dot */}
              <div className="mb-4 flex items-center gap-3 pl-5 relative">
                <div className={cn(
                  'absolute left-[-3px] top-1/2 -translate-y-1/2 size-2 rounded-full ring-2 ring-white',
                  group.procedureRecordId ? 'bg-sage' : 'bg-mid/40',
                )} />
                <h3 className="text-sm font-medium text-charcoal">
                  {group.procedureRecordId
                    ? (group.procedureTypeName ?? 'Procedimento')
                    : 'Fotos avulsas'}
                </h3>
                {group.procedureRecordId && group.procedurePerformedAt && (
                  <span className="text-xs text-mid">
                    {formatDate(group.procedurePerformedAt)}
                  </span>
                )}
                <span className="text-xs text-mid/60">
                  {group.photos.length} {group.photos.length === 1 ? 'foto' : 'fotos'}
                </span>
              </div>

              <div className="space-y-6 pl-5">
                {group.procedureRecordId
                  ? Object.entries(stageLabels).map(([stage, label]) =>
                      renderStageGroup(group.photos, stage, label)
                    )
                  : renderByDay(group.photos)
                }
              </div>
            </div>
          ))
        ) : (
          stagesWithPhotos.map((stageGroup) => (
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
                {stageGroup.photos.map(renderPhotoCard)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Full-size view dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={(open) => !open && setSelectedPhoto(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
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
                className="max-h-[60vh] rounded-lg object-contain"
              />
            </div>
          )}
          {selectedPhoto?.notes && (
            <p className="text-sm text-mid">{selectedPhoto.notes}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Crop dialog — opens when "Recortar" is clicked on a card. */}
      {cropTarget && cropTarget.signedUrl && (
        <ImageCropperDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setCropTarget(null)
          }}
          src={cropTarget.signedUrl}
          currentCrop={
            cropOverrides[cropTarget.id]?.cropBox ?? cropTarget.cropBox ?? null
          }
          sourceAspect={
            cropOverrides[cropTarget.id]?.sourceAspect ??
            cropTarget.cropAspect ??
            photoAspects[cropTarget.id] ??
            1
          }
          onSave={(box) => handleSaveCrop(cropTarget, box)}
          onCancel={() => setCropTarget(null)}
        />
      )}

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
