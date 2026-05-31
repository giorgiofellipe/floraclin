'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Crop, Loader2, RotateCcw, RotateCw, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'
import type { PhotoCropData } from '@/validations/photo-crop'
import type { FaceDetectionResult } from '@/lib/face-detection'
import { detectFace } from '@/lib/face-detection'
import { computeAutoCrop, type CropGeometry } from '@/lib/face-alignment'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoCropEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photo: PhotoAssetWithUrl | null
  onSaved?: () => void
}

type AspectKey = '3:4' | '4:3' | '1:1' | 'free'

type DragHandle =
  | 'move'
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'e'
  | 'w'

interface DragState {
  handle: DragHandle
  startX: number
  startY: number
  startCrop: CropGeometry
}

const ASPECT_RATIOS: Record<AspectKey, number | null> = {
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '1:1': 1,
  free: null,
}

const ASPECT_LABELS: Record<AspectKey, string> = {
  '3:4': '3:4',
  '4:3': '4:3',
  '1:1': '1:1',
  free: 'Livre',
}

const MIN_CROP_SIZE = 0.05

// ─── Component ──────────────────────────────────────────────────────

export function PhotoCropEditor({
  open,
  onOpenChange,
  photo,
  onSaved,
}: PhotoCropEditorProps) {
  const [cropBox, setCropBox] = useState<CropGeometry | null>(null)
  const [landmarks, setLandmarks] = useState<FaceDetectionResult['landmarks'] | null>(null)
  const [detectionRef, setDetectionRef] = useState<FaceDetectionResult | null>(null)
  const [aspect, setAspect] = useState<AspectKey>('3:4')
  const [rotation, setRotation] = useState(0)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [statusText, setStatusText] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })

  // ─── Load image & detect face on open ─────────────────────────────

  useEffect(() => {
    if (!open || !photo?.signedUrl) {
      setCropBox(null)
      setLandmarks(null)
      setDetectionRef(null)
      setRotation(0)
      setAspect('3:4')
      setStatusText('')
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })

      // If the photo already has a crop, restore it
      if (photo.cropBox) {
        setCropBox({
          x: photo.cropBox.x,
          y: photo.cropBox.y,
          width: photo.cropBox.width,
          height: photo.cropBox.height,
        })
        if (photo.cropBox.landmarks) {
          setLandmarks(photo.cropBox.landmarks)
        }
        if (photo.cropBox.aspect) {
          setAspect(photo.cropBox.aspect)
        }
        setRotation(photo.cropBox.rotation ?? 0)
        setStatusText('Recorte existente restaurado')
        return
      }

      // Run face detection
      setDetecting(true)
      setStatusText('Detectando rosto...')
      try {
        const result = await detectFace(img)
        if (result) {
          setLandmarks(result.landmarks)
          setDetectionRef(result)
          const autoCrop = computeAutoCrop(result, '3:4')
          setCropBox(autoCrop)
          setStatusText('Rosto detectado — recorte sugerido')
        } else {
          // No face found, default to centered 3:4 crop
          const ratio = 3 / 4
          const cropH = 0.8
          const cropW = Math.min(cropH * ratio, 1)
          setCropBox({
            x: (1 - cropW) / 2,
            y: (1 - cropH) / 2,
            width: cropW,
            height: cropH,
          })
          setStatusText('Nenhum rosto detectado')
        }
      } catch {
        const ratio = 3 / 4
        const cropH = 0.8
        const cropW = Math.min(cropH * ratio, 1)
        setCropBox({
          x: (1 - cropW) / 2,
          y: (1 - cropH) / 2,
          width: cropW,
          height: cropH,
        })
        setStatusText('Erro na detecção — recorte manual')
      } finally {
        setDetecting(false)
      }
    }
    img.src = photo.signedUrl
  }, [open, photo?.signedUrl, photo?.cropBox, photo?.id])

  // ─── Track rendered image size ────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const observer = new ResizeObserver(() => {
      if (imgRef.current) {
        setImgSize({
          w: imgRef.current.clientWidth,
          h: imgRef.current.clientHeight,
        })
      }
    })
    const timer = setTimeout(() => {
      if (imgRef.current) {
        observer.observe(imgRef.current)
        setImgSize({
          w: imgRef.current.clientWidth,
          h: imgRef.current.clientHeight,
        })
      }
    }, 50)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [open, photo?.signedUrl])

  // ─── Coordinate helpers ───────────────────────────────────────────

  const toNorm = useCallback(
    (clientX: number, clientY: number): { nx: number; ny: number } => {
      const img = imgRef.current
      if (!img) return { nx: 0, ny: 0 }
      const rect = img.getBoundingClientRect()
      return {
        nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
      }
    },
    [],
  )

  // ─── Drag interaction ─────────────────────────────────────────────

  const onPointerDown = useCallback(
    (handle: DragHandle, e: React.PointerEvent) => {
      if (!cropBox) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      const { nx, ny } = toNorm(e.clientX, e.clientY)
      setDragState({
        handle,
        startX: nx,
        startY: ny,
        startCrop: { ...cropBox },
      })
    },
    [cropBox, toNorm],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState || !cropBox) return
      e.preventDefault()
      const { nx, ny } = toNorm(e.clientX, e.clientY)
      const dx = nx - dragState.startX
      const dy = ny - dragState.startY
      const sc = dragState.startCrop
      const ratio = ASPECT_RATIOS[aspect]

      let newCrop: CropGeometry

      if (dragState.handle === 'move') {
        const newX = Math.max(0, Math.min(1 - sc.width, sc.x + dx))
        const newY = Math.max(0, Math.min(1 - sc.height, sc.y + dy))
        newCrop = { ...sc, x: newX, y: newY }
      } else {
        // Resize handles
        let { x, y, width, height } = sc

        const isLeft = dragState.handle.includes('w')
        const isTop = dragState.handle.includes('n')
        const isRight = dragState.handle.includes('e')
        const isBottom = dragState.handle.includes('s')

        if (isRight) {
          width = Math.max(MIN_CROP_SIZE, Math.min(1 - x, sc.width + dx))
        }
        if (isBottom) {
          height = Math.max(MIN_CROP_SIZE, Math.min(1 - y, sc.height + dy))
        }
        if (isLeft) {
          const newX = Math.max(0, sc.x + dx)
          width = Math.max(MIN_CROP_SIZE, sc.x + sc.width - newX)
          x = sc.x + sc.width - width
        }
        if (isTop) {
          const newY = Math.max(0, sc.y + dy)
          height = Math.max(MIN_CROP_SIZE, sc.y + sc.height - newY)
          y = sc.y + sc.height - height
        }

        // Enforce aspect ratio
        if (ratio) {
          if (isLeft || isRight) {
            height = width / ratio
            if (y + height > 1) {
              height = 1 - y
              width = height * ratio
            }
          } else if (isTop || isBottom) {
            width = height * ratio
            if (x + width > 1) {
              width = 1 - x
              height = width / ratio
            }
          }
        }

        newCrop = { x, y, width, height }
      }

      setCropBox(newCrop)
    },
    [dragState, cropBox, toNorm, aspect],
  )

  const onPointerUp = useCallback(() => {
    setDragState(null)
  }, [])

  // ─── Aspect ratio change ──────────────────────────────────────────

  const changeAspect = useCallback(
    (newAspect: AspectKey) => {
      setAspect(newAspect)
      if (!cropBox) return
      const ratio = ASPECT_RATIOS[newAspect]
      if (!ratio) return

      // Recalculate crop with new aspect, keeping center
      const cx = cropBox.x + cropBox.width / 2
      const cy = cropBox.y + cropBox.height / 2
      let newW = cropBox.width
      let newH = newW / ratio

      if (newH > 1) {
        newH = 1
        newW = newH * ratio
      }
      if (newW > 1) {
        newW = 1
        newH = newW / ratio
      }

      const newX = Math.max(0, Math.min(1 - newW, cx - newW / 2))
      const newY = Math.max(0, Math.min(1 - newH, cy - newH / 2))
      setCropBox({ x: newX, y: newY, width: newW, height: newH })
    },
    [cropBox],
  )

  // ─── Reset ────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (!photo?.signedUrl) return
    setAspect('3:4')
    setRotation(0)

    if (detectionRef) {
      setCropBox(computeAutoCrop(detectionRef, '3:4'))
      setStatusText('Recorte redefinido para sugestão automática')
    } else {
      const ratio = 3 / 4
      const cropH = 0.8
      const cropW = Math.min(cropH * ratio, 1)
      setCropBox({
        x: (1 - cropW) / 2,
        y: (1 - cropH) / 2,
        width: cropW,
        height: cropH,
      })
      setStatusText('Recorte redefinido')
    }
  }, [photo?.signedUrl, landmarks, naturalSize])

  // ─── Save ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!photo || !cropBox) return
    setSaving(true)
    try {
      const cropData: PhotoCropData = {
        x: cropBox.x,
        y: cropBox.y,
        width: cropBox.width,
        height: cropBox.height,
        rotation,
        aspect,
        landmarks: landmarks ?? undefined,
      }
      const res = await fetch(`/api/photos/${photo.id}/crop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropBox: cropData }),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        throw new Error(msg || 'Erro ao salvar recorte')
      }
      toast.success('Recorte salvo com sucesso')
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar recorte')
    } finally {
      setSaving(false)
    }
  }, [photo, cropBox, rotation, aspect, landmarks, onSaved, onOpenChange])

  // ─── Overlay clip path ────────────────────────────────────────────

  const clipPath = cropBox
    ? `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        ${cropBox.x * 100}% ${cropBox.y * 100}%,
        ${cropBox.x * 100}% ${(cropBox.y + cropBox.height) * 100}%,
        ${(cropBox.x + cropBox.width) * 100}% ${(cropBox.y + cropBox.height) * 100}%,
        ${(cropBox.x + cropBox.width) * 100}% ${cropBox.y * 100}%,
        ${cropBox.x * 100}% ${cropBox.y * 100}%
      )`
    : undefined

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[90vw] sm:max-w-2xl flex-col p-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogHeader className="flex-row items-center gap-2">
            <Crop className="size-4 text-mid" />
            <DialogTitle>Recortar Foto</DialogTitle>
          </DialogHeader>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Image + crop area */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-100"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {photo?.signedUrl ? (
            <>
              {/* Underlying image */}
              <img
                ref={imgRef}
                src={photo.signedUrl}
                alt="Foto para recorte"
                className="max-h-full max-w-full object-contain select-none"
                draggable={false}
                style={{
                  transform: rotation ? `rotate(${rotation}deg)` : undefined,
                }}
              />

              {/* Dark overlay outside crop */}
              {cropBox && imgSize.w > 0 && (
                <div
                  className="pointer-events-none absolute"
                  style={{
                    width: imgSize.w,
                    height: imgSize.h,
                    left: imgRef.current
                      ? imgRef.current.offsetLeft
                      : '50%',
                    top: imgRef.current
                      ? imgRef.current.offsetTop
                      : '50%',
                    clipPath,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                  }}
                />
              )}

              {/* Crop frame + handles */}
              {cropBox && imgSize.w > 0 && (
                <div
                  className="absolute border-2 border-white cursor-move"
                  style={{
                    left: (imgRef.current?.offsetLeft ?? 0) + cropBox.x * imgSize.w,
                    top: (imgRef.current?.offsetTop ?? 0) + cropBox.y * imgSize.h,
                    width: cropBox.width * imgSize.w,
                    height: cropBox.height * imgSize.h,
                  }}
                  onPointerDown={(e) => onPointerDown('move', e)}
                >
                  {/* Rule of thirds grid */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
                    <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
                    <div className="absolute top-1/3 left-0 w-full h-px bg-white/30" />
                    <div className="absolute top-2/3 left-0 w-full h-px bg-white/30" />
                  </div>

                  {/* Corner handles */}
                  {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <div
                      key={corner}
                      className={cn(
                        'absolute size-3 rounded-full bg-white border-2 border-sage shadow-sm',
                        corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                        corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                        corner === 'sw' && '-left-1.5 -bottom-1.5 cursor-nesw-resize',
                        corner === 'se' && '-right-1.5 -bottom-1.5 cursor-nwse-resize',
                      )}
                      onPointerDown={(e) => onPointerDown(corner, e)}
                    />
                  ))}

                  {/* Edge handles */}
                  {(['n', 's', 'e', 'w'] as const).map((edge) => (
                    <div
                      key={edge}
                      className={cn(
                        'absolute bg-white/80 rounded-full',
                        (edge === 'n' || edge === 's') &&
                          'left-1/2 -translate-x-1/2 h-1 w-6 cursor-ns-resize',
                        edge === 'n' && '-top-0.5',
                        edge === 's' && '-bottom-0.5',
                        (edge === 'e' || edge === 'w') &&
                          'top-1/2 -translate-y-1/2 w-1 h-6 cursor-ew-resize',
                        edge === 'e' && '-right-0.5',
                        edge === 'w' && '-left-0.5',
                      )}
                      onPointerDown={(e) => onPointerDown(edge, e)}
                    />
                  ))}
                </div>
              )}

              {/* Landmark dots */}
              {landmarks && imgSize.w > 0 && (
                <>
                  {[
                    { pt: landmarks.leftEye, label: 'Olho esq.' },
                    { pt: landmarks.rightEye, label: 'Olho dir.' },
                    { pt: landmarks.noseTip, label: 'Nariz' },
                  ].map(({ pt, label }) => (
                    <div
                      key={label}
                      className="pointer-events-none absolute size-2.5 rounded-full bg-green-400 border border-green-600 shadow-sm"
                      title={label}
                      style={{
                        left:
                          (imgRef.current?.offsetLeft ?? 0) +
                          pt.x * imgSize.w -
                          5,
                        top:
                          (imgRef.current?.offsetTop ?? 0) +
                          pt.y * imgSize.h -
                          5,
                      }}
                    />
                  ))}

                  {/* Eye-level line */}
                  <div
                    className="pointer-events-none absolute h-px bg-green-400/60"
                    style={{
                      left: imgRef.current?.offsetLeft ?? 0,
                      top:
                        (imgRef.current?.offsetTop ?? 0) +
                        ((landmarks.leftEye.y + landmarks.rightEye.y) / 2) *
                          imgSize.h,
                      width: imgSize.w,
                    }}
                  />

                  {/* Vertical center line (face symmetry) */}
                  <div
                    className="pointer-events-none absolute w-px border-l border-dashed border-green-400/50"
                    style={{
                      left:
                        (imgRef.current?.offsetLeft ?? 0) +
                        landmarks.noseTip.x * imgSize.w,
                      top: imgRef.current?.offsetTop ?? 0,
                      height: imgSize.h,
                    }}
                  />

                  {/* Face outline oval */}
                  {detectionRef && (
                    <div
                      className="pointer-events-none absolute rounded-[50%] border border-dashed border-green-400/40"
                      style={{
                        left:
                          (imgRef.current?.offsetLeft ?? 0) +
                          detectionRef.boundingBox.x * imgSize.w,
                        top:
                          (imgRef.current?.offsetTop ?? 0) +
                          detectionRef.boundingBox.y * imgSize.h,
                        width: detectionRef.boundingBox.width * imgSize.w,
                        height: detectionRef.boundingBox.height * imgSize.h,
                      }}
                    />
                  )}
                </>
              )}

              {/* Loading spinner */}
              {detecting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-lg">
                    <Loader2 className="size-4 animate-spin text-sage" />
                    <span className="text-sm text-charcoal">
                      Detectando rosto...
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center text-mid">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex items-center gap-1">
            {(Object.keys(ASPECT_LABELS) as AspectKey[]).map((key) => (
              <Button
                key={key}
                variant={aspect === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => changeAspect(key)}
                disabled={detecting || saving}
              >
                {ASPECT_LABELS[key]}
              </Button>
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={detecting || saving}
            >
              <RotateCcw className="size-3.5 mr-1" />
              Redefinir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              disabled={detecting || saving}
            >
              <RotateCw className="size-3.5 mr-1" />
              Girar
            </Button>
          </div>

          {statusText && (
            <span className="text-xs text-mid hidden sm:inline">
              {statusText}
            </span>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!cropBox || detecting || saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="size-3.5 mr-1" />
              )}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
