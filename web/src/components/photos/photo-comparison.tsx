'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X, Crop as CropIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { cn, formatDate } from '@/lib/utils'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'
import { timelineStageLabels } from '@/validations/photo'
import type { CropBox } from '@/validations/photo'
import type { TimelineStage } from '@/types'
import { applyCrop } from '@/lib/photos'
import { ImageCropperDialog } from './image-cropper'
import { useUpdatePhotoCrop } from '@/hooks/queries/use-photo-crop'

type ComparisonMode = 'slider' | 'side-by-side' | 'overlay'

interface PhotoComparisonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photoA: PhotoAssetWithUrl | null
  photoB: PhotoAssetWithUrl | null
}

function getPhotoLabel(photo: PhotoAssetWithUrl) {
  const stage = photo.timelineStage
    ? timelineStageLabels[photo.timelineStage as TimelineStage]
    : 'Foto'
  const date = photo.procedurePerformedAt
    ? formatDate(photo.procedurePerformedAt)
    : formatDate(photo.createdAt)
  const proc = photo.procedureTypeName
  return proc ? `${stage} · ${proc} · ${date}` : `${stage} · ${date}`
}

export function PhotoComparisonDialog({
  open,
  onOpenChange,
  photoA,
  photoB,
}: PhotoComparisonDialogProps) {
  const [mode, setMode] = useState<ComparisonMode>('slider')
  const [urlA, setUrlA] = useState<string | null>(null)
  const [urlB, setUrlB] = useState<string | null>(null)
  const [loadingUrls, setLoadingUrls] = useState(false)
  const [opacity, setOpacity] = useState(50)
  const [sliderPosition, setSliderPosition] = useState(50)
  const sliderContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // Crop state — persisted `cropBox`/`cropAspect` come in on each photo prop;
  // we layer session-local overrides on top so saves render immediately. The
  // measured-aspect map is a fallback for old rows that don't have a
  // `cropAspect` yet (e.g. a freshly-uploaded photo about to be cropped for
  // the first time).
  const [cropTarget, setCropTarget] = useState<'A' | 'B' | null>(null)
  const [cropOverrides, setCropOverrides] = useState<
    Record<string, { cropBox: CropBox | null; sourceAspect: number }>
  >({})
  const [aspects, setAspects] = useState<Record<string, number>>({})

  const updateCrop = useUpdatePhotoCrop()

  useEffect(() => {
    if (!open || !photoA || !photoB) {
      setUrlA(null)
      setUrlB(null)
      setSliderPosition(50)
      return
    }

    async function loadUrls() {
      setLoadingUrls(true)
      try {
        const params = new URLSearchParams({ photoIdA: photoA!.id, photoIdB: photoB!.id })
        const res = await fetch(`/api/photos?${params}`)
        const result = await res.json()
        if (result.success && result.data) {
          setUrlA(result.data.urlA)
          setUrlB(result.data.urlB)
        }
      } finally {
        setLoadingUrls(false)
      }
    }
    loadUrls()
  }, [open, photoA, photoB])

  const handleSliderStart = useCallback(() => {
    isDragging.current = true
  }, [])

  useEffect(() => {
    function updatePosition(clientX: number) {
      if (!isDragging.current || !sliderContainerRef.current) return
      const rect = sliderContainerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
      setSliderPosition((x / rect.width) * 100)
    }

    const handleMouseMove = (e: MouseEvent) => updatePosition(e.clientX)
    const handleTouchMove = (e: TouchEvent) => updatePosition(e.touches[0].clientX)
    const handleEnd = () => { isDragging.current = false }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', handleTouchMove)
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
    }
  }, [])

  const handleImageLoaded = useCallback(
    (photoId: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (img.naturalHeight <= 0) return
      const aspect = img.naturalWidth / img.naturalHeight
      setAspects((prev) => (prev[photoId] ? prev : { ...prev, [photoId]: aspect }))
    },
    [],
  )

  const handleSaveCrop = useCallback(
    async (photo: PhotoAssetWithUrl, box: CropBox | null) => {
      // Prefer the persisted aspect over a freshly measured one — it's the
      // value used when the crop coordinates were first chosen, so it's the
      // right scale to feed back into `applyCrop`.
      const sourceAspect = photo.cropAspect ?? aspects[photo.id] ?? 1
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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao salvar recorte.')
      }
    },
    [aspects, updateCrop],
  )

  const labelA = photoA ? getPhotoLabel(photoA) : ''
  const labelB = photoB ? getPhotoLabel(photoB) : ''

  // Per-side crop style helpers — effective crop = optimistic override ??
  // persisted on the photo ?? none. Aspect prefers override/persisted, falls
  // back to the on-load measurement for old photos missing `cropAspect`.
  function styleFor(photo: PhotoAssetWithUrl | null) {
    if (!photo) return null
    const ov = cropOverrides[photo.id]
    const box = ov ? ov.cropBox : photo.cropBox
    const aspect = ov?.sourceAspect ?? photo.cropAspect ?? aspects[photo.id]
    return box && aspect ? applyCrop(box, aspect) : null
  }

  const styleA = styleFor(photoA)
  const styleB = styleFor(photoB)

  const cropTargetPhoto = cropTarget === 'A' ? photoA : cropTarget === 'B' ? photoB : null
  const cropTargetUrl = cropTarget === 'A' ? urlA : cropTarget === 'B' ? urlB : null
  const cropTargetAspect = cropTargetPhoto
    ? (cropOverrides[cropTargetPhoto.id]?.sourceAspect ??
        cropTargetPhoto.cropAspect ??
        aspects[cropTargetPhoto.id] ??
        1)
    : 1
  const cropTargetCurrent = cropTargetPhoto
    ? (cropOverrides[cropTargetPhoto.id]?.cropBox ??
        cropTargetPhoto.cropBox ??
        null)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[95vh] overflow-hidden border-0 bg-[#1C2B1E] p-0 [&>button:last-child]:hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-1">
            {(['slider', 'side-by-side', 'overlay'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  mode === m
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:text-white/80'
                )}
              >
                {m === 'slider' ? 'Slider' : m === 'side-by-side' ? 'Lado a Lado' : 'Sobreposição'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {/* Per-side crop triggers */}
            {photoA && urlA && (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/10 text-xs"
                onClick={() => setCropTarget('A')}
              >
                <CropIcon className="size-3.5" />
                Recortar A
              </Button>
            )}
            {photoB && urlB && (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/10 text-xs"
                onClick={() => setCropTarget('B')}
              >
                <CropIcon className="size-3.5" />
                Recortar B
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white/60 hover:text-white hover:bg-white/10"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>

        {/* Content area */}
        <div className="px-4 pb-4">
          {loadingUrls ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-6 animate-spin text-white/40" />
            </div>
          ) : !urlA || !urlB ? (
            <div className="flex items-center justify-center py-24">
              <p className="text-sm text-white/40">Erro ao carregar fotos.</p>
            </div>
          ) : (
            <>
              {mode === 'slider' && (
                <div
                  ref={sliderContainerRef}
                  className="relative max-h-[70vh] cursor-col-resize select-none overflow-hidden rounded-lg"
                >
                  {/* Right side: photo B. */}
                  {styleB ? (
                    <div className="relative w-full overflow-hidden" style={styleB.containerStyle}>
                      <img
                        src={urlB}
                        alt="Foto B"
                        className="block"
                        style={styleB.imageStyle}
                        draggable={false}
                        onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                      />
                    </div>
                  ) : (
                    <img
                      src={urlB}
                      alt="Foto B"
                      className="h-auto max-h-[70vh] w-full object-contain"
                      draggable={false}
                      onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                    />
                  )}
                  {/* Left side: photo A clipped to slider position. */}
                  <div
                    className="absolute inset-0"
                    style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                  >
                    {styleA ? (
                      <div className="relative h-full w-full overflow-hidden" style={styleA.containerStyle}>
                        <img
                          src={urlA}
                          alt="Foto A"
                          className="block"
                          style={styleA.imageStyle}
                          draggable={false}
                          onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                        />
                      </div>
                    ) : (
                      <img
                        src={urlA}
                        alt="Foto A"
                        className="h-full w-full object-contain"
                        draggable={false}
                        onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                      />
                    )}
                  </div>
                  <div
                    className="absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)]"
                    style={{ left: `${sliderPosition}%` }}
                  >
                    <div
                      className="absolute top-1/2 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#4A6B52] shadow-lg"
                      onMouseDown={handleSliderStart}
                      onTouchStart={handleSliderStart}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-white">
                        <path d="M4 3L1 7L4 11M10 3L13 7L10 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-[11px] text-white/90">{labelA}</div>
                  <div className="absolute bottom-3 right-3 rounded-md bg-black/60 px-2.5 py-1 text-[11px] text-white/90">{labelB}</div>
                </div>
              )}

              {mode === 'side-by-side' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg">
                      {styleA ? (
                        <div className="relative w-full overflow-hidden" style={styleA.containerStyle}>
                          <img
                            src={urlA}
                            alt="Foto A"
                            className="block"
                            style={styleA.imageStyle}
                            onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                          />
                        </div>
                      ) : (
                        <img
                          src={urlA}
                          alt="Foto A"
                          className="h-auto max-h-[70vh] w-full object-contain"
                          onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                        />
                      )}
                    </div>
                    <p className="text-center text-[11px] text-white/60">{labelA}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg">
                      {styleB ? (
                        <div className="relative w-full overflow-hidden" style={styleB.containerStyle}>
                          <img
                            src={urlB}
                            alt="Foto B"
                            className="block"
                            style={styleB.imageStyle}
                            onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                          />
                        </div>
                      ) : (
                        <img
                          src={urlB}
                          alt="Foto B"
                          className="h-auto max-h-[70vh] w-full object-contain"
                          onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                        />
                      )}
                    </div>
                    <p className="text-center text-[11px] text-white/60">{labelB}</p>
                  </div>
                </div>
              )}

              {mode === 'overlay' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-xs text-white/50">Opacidade</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                      className="h-1.5 w-48 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#4A6B52]"
                    />
                    <span className="text-xs text-white/50 tabular-nums w-8">{opacity}%</span>
                  </div>
                  <div className="relative overflow-hidden rounded-lg">
                    {styleA ? (
                      <div className="relative w-full overflow-hidden" style={styleA.containerStyle}>
                        <img
                          src={urlA}
                          alt="Foto A"
                          className="block"
                          style={styleA.imageStyle}
                          onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                        />
                      </div>
                    ) : (
                      <img
                        src={urlA}
                        alt="Foto A"
                        className="h-auto max-h-[70vh] w-full object-contain"
                        onLoad={photoA ? handleImageLoaded(photoA.id) : undefined}
                      />
                    )}
                    {styleB ? (
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ ...styleB.containerStyle, opacity: opacity / 100 }}
                      >
                        <img
                          src={urlB}
                          alt="Foto B"
                          className="block"
                          style={styleB.imageStyle}
                          onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                        />
                      </div>
                    ) : (
                      <img
                        src={urlB}
                        alt="Foto B"
                        className="absolute inset-0 h-full w-full object-contain"
                        style={{ opacity: opacity / 100 }}
                        onLoad={photoB ? handleImageLoaded(photoB.id) : undefined}
                      />
                    )}
                  </div>
                  <div className="flex justify-between">
                    <p className="text-[11px] text-white/60">{labelA}</p>
                    <p className="text-[11px] text-white/60">{labelB}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Crop dialog (per-side) */}
        {cropTargetPhoto && cropTargetUrl && (
          <ImageCropperDialog
            open={true}
            onOpenChange={(o) => {
              if (!o) setCropTarget(null)
            }}
            src={cropTargetUrl}
            currentCrop={cropTargetCurrent}
            sourceAspect={cropTargetAspect}
            onSave={(box) => handleSaveCrop(cropTargetPhoto, box)}
            onCancel={() => setCropTarget(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
