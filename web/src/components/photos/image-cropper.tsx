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
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CropBox } from '@/validations/photo'

// ─── Constants ──────────────────────────────────────────────────────

// Minimum pixel size for either dimension of the crop when rendered against
// the natural image. Boxes that would produce a smaller image are rejected.
const MIN_CROP_DIMENSION_PX = 50

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

// ─── Component ──────────────────────────────────────────────────────

export function ImageCropper({
  src,
  currentCrop,
  sourceAspect,
  onSave,
  onCancel,
}: ImageCropperProps) {
  // State is initialized from props once. Re-mount the component (via a
  // `key={src}` or conditional rendering at the dialog boundary) when you
  // need to reset for a different image — avoids cascading renders from a
  // setState-in-effect pattern.
  const [crop, setCrop] = useState<Crop>(() =>
    currentCrop ? cropBoxToPercentCrop(currentCrop) : defaultPercentCrop(),
  )
  const [imageLoaded, setImageLoaded] = useState(false)
  const naturalSize = useRef<{ width: number; height: number } | null>(null)

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    naturalSize.current = { width: img.naturalWidth, height: img.naturalHeight }
    setImageLoaded(true)
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
    <div className="space-y-3">
      <div className="flex max-h-[65vh] items-center justify-center overflow-auto rounded-[3px] bg-[#1C2B1E]/95 p-2">
        <ReactCrop
          crop={crop}
          aspect={sourceAspect}
          onChange={(_pixelCrop, percentageCrop) => setCrop(percentageCrop)}
          keepSelection
          className="max-w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Recortar"
            onLoad={handleImageLoad}
            className="block max-h-[60vh] w-auto max-w-full"
            draggable={false}
          />
        </ReactCrop>
      </div>
      {!imageLoaded && (
        <div className="flex items-center justify-center gap-2 text-xs text-mid">
          <Loader2 className="size-3 animate-spin" />
          Carregando imagem...
        </div>
      )}
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
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* `key={src}` forces a fresh mount when switching images so the inner
            crop state is re-initialized from the new `currentCrop` prop. */}
        <ImageCropper key={cropperProps.src} {...cropperProps} />
      </DialogContent>
    </Dialog>
  )
}
