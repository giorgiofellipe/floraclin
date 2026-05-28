'use client'

import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import ReactCrop, { type Crop, type PercentCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, ZoomIn } from 'lucide-react'
import { toast } from 'sonner'
import type { CropBox } from '@/validations/photo'

// ─── Constants ──────────────────────────────────────────────────────

// Minimum pixel size for either dimension of the crop when rendered against
// the natural image. Boxes that would produce a smaller image are rejected.
const MIN_CROP_DIMENSION_PX = 50

// Max zoom factor when the slider is at 100%. 5x means the smallest crop
// covers 1/5 of the image's width (and height — aspect-locked) — tight
// enough to focus on a face area without becoming unusable.
const MAX_ZOOM = 5

// ─── Props ──────────────────────────────────────────────────────────

export interface ImageCropperProps {
  src: string
  /** Existing normalized crop or null for un-cropped photos. */
  currentCrop: CropBox | null
  /** Natural width / height of the underlying image. Used to lock aspect. */
  sourceAspect: number
  /** Pass `null` to clear the crop. */
  onSave: (crop: CropBox | null) => void
  onCancel: () => void
}

// ─── Helpers ────────────────────────────────────────────────────────

function cropBoxToPercentCrop(box: CropBox): PercentCrop {
  return {
    unit: '%',
    x: box.x * 100,
    y: box.y * 100,
    width: box.width * 100,
    height: box.height * 100,
  }
}

function percentToCropBox(crop: Crop): CropBox {
  return {
    x: crop.x / 100,
    y: crop.y / 100,
    width: crop.width / 100,
    height: crop.height / 100,
  }
}

function defaultPercentCrop(): PercentCrop {
  return { unit: '%', x: 0, y: 0, width: 100, height: 100 }
}

/**
 * Derives a 0–100 slider position from a normalized crop. 0% slider = full
 * image (no zoom). 100% slider = MAX_ZOOM crop. Aspect-locked crops have
 * crop.width === crop.height in normalized coords (different visual sizes,
 * same numeric fraction), so width alone is enough.
 */
function cropToZoomPercent(crop: PercentCrop): number {
  const cropWidth = crop.width / 100
  if (cropWidth >= 1) return 0
  if (cropWidth <= 1 / MAX_ZOOM) return 100
  // zoom = 1 / cropWidth, slider = (zoom - 1) / (MAX_ZOOM - 1) * 100
  const zoom = 1 / cropWidth
  return Math.round(((zoom - 1) / (MAX_ZOOM - 1)) * 100)
}

/** Inverse of cropToZoomPercent — produces a centered aspect-locked crop. */
function zoomPercentToCrop(zoomPercent: number): PercentCrop {
  const zoom = 1 + (zoomPercent / 100) * (MAX_ZOOM - 1)
  const sizePct = (1 / zoom) * 100
  const offsetPct = (100 - sizePct) / 2
  return {
    unit: '%',
    x: offsetPct,
    y: offsetPct,
    width: sizePct,
    height: sizePct,
  }
}

// ─── Component ──────────────────────────────────────────────────────

export function ImageCropper({
  src,
  currentCrop,
  sourceAspect,
  onSave,
  onCancel,
}: ImageCropperProps) {
  // Always start with the crop rectangle spanning the full image, even if a
  // saved crop already exists on the photo. That way the user begins from a
  // clean canvas and can either drag in or use the zoom slider; the
  // "Remover recorte" button still acknowledges the saved state. State is
  // initialized once — re-mount the component (via a `key={src}` or
  // conditional rendering at the dialog boundary) to reset for a different
  // image, which avoids cascading renders from a setState-in-effect pattern.
  void currentCrop // used below for the Remover-recorte affordance only
  const [crop, setCrop] = useState<Crop>(() => defaultPercentCrop())
  const [zoomPercent, setZoomPercent] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const naturalSize = useRef<{ width: number; height: number } | null>(null)

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    naturalSize.current = { width: img.naturalWidth, height: img.naturalHeight }
    setImageLoaded(true)
  }, [])

  const handleCropChange = useCallback(
    (_pixelCrop: Crop, percentageCrop: PercentCrop) => {
      setCrop(percentageCrop)
      setZoomPercent(cropToZoomPercent(percentageCrop))
    },
    [],
  )

  const handleZoomChange = useCallback((next: number) => {
    setZoomPercent(next)
    setCrop(zoomPercentToCrop(next))
  }, [])

  const handleSave = useCallback(() => {
    const box = percentToCropBox(crop)

    // Sanity bounds (zod will also enforce server-side).
    if (box.width <= 0 || box.height <= 0) {
      toast.error('Selecione uma área válida para recortar.')
      return
    }

    if (naturalSize.current) {
      const widthPx = box.width * naturalSize.current.width
      const heightPx = box.height * naturalSize.current.height
      if (widthPx < MIN_CROP_DIMENSION_PX || heightPx < MIN_CROP_DIMENSION_PX) {
        toast.error(
          `Recorte muito pequeno. O menor lado deve ter ao menos ${MIN_CROP_DIMENSION_PX}px.`,
        )
        return
      }
    }

    onSave(box)
  }, [crop, onSave])

  const handleRemove = useCallback(() => {
    onSave(null)
  }, [onSave])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Image area — fixed-height flex slot; the <style jsx> below forces
          ReactCrop's nested wrapper divs to fit the slot via max-h/max-w +
          object-contain, otherwise the library lets the image render at its
          natural pixel size and overflow. */}
      <div className="image-cropper-slot relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[3px] bg-[#1C2B1E]/95 p-2">
        <ReactCrop
          crop={crop}
          aspect={sourceAspect}
          onChange={handleCropChange}
          keepSelection
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Recortar"
            onLoad={handleImageLoad}
            draggable={false}
          />
        </ReactCrop>
        {!imageLoaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs text-cream/70">
            <Loader2 className="size-3 animate-spin" />
            Carregando imagem...
          </div>
        )}
        <style jsx global>{`
          /* react-image-crop's own DOM doesn't set a max size on the wrapper
             or the inner image, so the natural pixel dimensions leak out and
             break our fixed-height container. Constrain the whole tree. */
          .image-cropper-slot .ReactCrop {
            display: flex !important;
            max-width: 100% !important;
            max-height: 100% !important;
          }
          .image-cropper-slot .ReactCrop__child-wrapper {
            display: flex !important;
            max-width: 100% !important;
            max-height: 100% !important;
            align-items: center;
            justify-content: center;
          }
          .image-cropper-slot .ReactCrop img {
            display: block !important;
            max-width: 100% !important;
            max-height: 100% !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain;
          }
        `}</style>
      </div>

      {/* Zoom slider — quick way to shrink/center the crop box without
          dragging corners. Updates the same crop state; ReactCrop reflects it
          live. The crop center stays fixed so the user can keep refining. */}
      <div className="flex items-center gap-3 px-1">
        <ZoomIn className="size-4 text-mid" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={zoomPercent}
          onChange={(e) => handleZoomChange(Number(e.target.value))}
          disabled={!imageLoaded}
          aria-label="Zoom do recorte"
          className="flex-1 accent-forest"
        />
        <span className="w-12 text-right text-xs tabular-nums text-mid">
          {(1 + (zoomPercent / 100) * (MAX_ZOOM - 1)).toFixed(1)}×
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        {currentCrop != null && (
          <Button type="button" variant="ghost" onClick={handleRemove}>
            Remover recorte
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSave}
          disabled={!imageLoaded}
          className="bg-forest text-cream hover:bg-sage"
        >
          Salvar recorte
        </Button>
      </div>
    </div>
  )
}

// ─── Dialog wrapper ─────────────────────────────────────────────────

interface ImageCropperDialogProps extends ImageCropperProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

/**
 * Convenience wrapper that mounts <ImageCropper> inside a modal. Used by the
 * gallery (existing photo) and comparison view. The uploader keeps its own
 * compact preview-side modal but can also adopt this.
 */
export function ImageCropperDialog({
  open,
  onOpenChange,
  title = 'Recortar foto',
  ...cropperProps
}: ImageCropperDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-5xl flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Fill the remaining dialog height; the inner cropper's image grows
            to whichever dimension is the tighter constraint, no scroll.
            `key={src}` forces a fresh mount when switching images so the
            inner crop state is re-initialized from the new `currentCrop`. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ImageCropper key={cropperProps.src} {...cropperProps} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
