'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { cn, formatDate } from '@/lib/utils'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'
import { timelineStageLabels } from '@/validations/photo'
import type { TimelineStage } from '@/types'

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

  const labelA = photoA ? getPhotoLabel(photoA) : ''
  const labelB = photoB ? getPhotoLabel(photoB) : ''

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
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/60 hover:text-white hover:bg-white/10"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-5" />
          </Button>
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
                  <img
                    src={urlB}
                    alt="Foto B"
                    className="h-auto max-h-[70vh] w-full object-contain"
                    draggable={false}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                  >
                    <img
                      src={urlA}
                      alt="Foto A"
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
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
                      <img src={urlA} alt="Foto A" className="h-auto max-h-[70vh] w-full object-contain" />
                    </div>
                    <p className="text-center text-[11px] text-white/60">{labelA}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg">
                      <img src={urlB} alt="Foto B" className="h-auto max-h-[70vh] w-full object-contain" />
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
                    <img src={urlA} alt="Foto A" className="h-auto max-h-[70vh] w-full object-contain" />
                    <img
                      src={urlB}
                      alt="Foto B"
                      className="absolute inset-0 h-full w-full object-contain"
                      style={{ opacity: opacity / 100 }}
                    />
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
      </DialogContent>
    </Dialog>
  )
}
