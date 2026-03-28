'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { listPhotosAction, getComparisonUrlsAction } from '@/actions/photos'
import type { PhotoAssetWithUrl } from '@/db/queries/photos'
import { timelineStageLabels } from '@/validations/photo'
import type { TimelineStage } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────

interface PhotoComparisonProps {
  patientId: string
  procedureRecordId?: string
}

type ComparisonMode = 'side-by-side' | 'overlay' | 'slider'

// ─── Component ──────────────────────────────────────────────────────

export function PhotoComparison({
  patientId,
  procedureRecordId,
}: PhotoComparisonProps) {
  const [allPhotos, setAllPhotos] = useState<PhotoAssetWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ComparisonMode>('side-by-side')
  const [photoIdA, setPhotoIdA] = useState<string>('')
  const [photoIdB, setPhotoIdB] = useState<string>('')
  const [urlA, setUrlA] = useState<string | null>(null)
  const [urlB, setUrlB] = useState<string | null>(null)
  const [loadingUrls, setLoadingUrls] = useState(false)
  const [opacity, setOpacity] = useState(50)
  const [sliderPosition, setSliderPosition] = useState(50)
  const sliderContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // Load all photos for patient
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const result = await listPhotosAction(patientId, procedureRecordId)
        if (result.success && result.data) {
          const photos = result.data.flatMap((s) => s.photos)
          setAllPhotos(photos)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [patientId, procedureRecordId])

  // Load signed URLs when photos are selected
  useEffect(() => {
    if (!photoIdA || !photoIdB) {
      setUrlA(null)
      setUrlB(null)
      return
    }

    async function loadUrls() {
      setLoadingUrls(true)
      try {
        const result = await getComparisonUrlsAction(photoIdA, photoIdB)
        if (result.success && result.data) {
          setUrlA(result.data.urlA)
          setUrlB(result.data.urlB)
        }
      } finally {
        setLoadingUrls(false)
      }
    }
    loadUrls()
  }, [photoIdA, photoIdB])

  // Slider drag handlers
  const handleSliderMouseDown = useCallback(() => {
    isDragging.current = true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !sliderContainerRef.current) return
      const rect = sliderContainerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      setSliderPosition((x / rect.width) * 100)
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || !sliderContainerRef.current) return
      const rect = sliderContainerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width))
      setSliderPosition((x / rect.width) * 100)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchmove', handleTouchMove)
    window.addEventListener('touchend', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleMouseUp)
    }
  }, [])

  const getPhotoLabel = useCallback(
    (photo: PhotoAssetWithUrl) => {
      const stage = photo.timelineStage
        ? timelineStageLabels[photo.timelineStage as TimelineStage]
        : 'Sem estágio'
      const name = photo.originalFilename
        ? photo.originalFilename.length > 20
          ? photo.originalFilename.slice(0, 20) + '...'
          : photo.originalFilename
        : 'Foto'
      return `${stage} — ${name}`
    },
    []
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando fotos...</span>
      </div>
    )
  }

  if (allPhotos.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">É necessário pelo menos 2 fotos para comparação.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Photo selectors */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label>Foto A</Label>
          <Select value={photoIdA} onValueChange={(v) => v && setPhotoIdA(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Selecione a foto A" />
            </SelectTrigger>
            <SelectContent>
              {allPhotos.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={p.id === photoIdB}>
                  {getPhotoLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Foto B</Label>
          <Select value={photoIdB} onValueChange={(v) => v && setPhotoIdB(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Selecione a foto B" />
            </SelectTrigger>
            <SelectContent>
              {allPhotos.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={p.id === photoIdA}>
                  {getPhotoLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mode selector */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as ComparisonMode)}>
        <TabsList>
          <TabsTrigger value="side-by-side">Lado a Lado</TabsTrigger>
          <TabsTrigger value="overlay">Sobreposição</TabsTrigger>
          <TabsTrigger value="slider">Slider</TabsTrigger>
        </TabsList>

        {/* Comparison views */}
        {loadingUrls ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !urlA || !urlB ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">Selecione duas fotos para comparar.</p>
          </div>
        ) : (
          <>
            {/* Side by side */}
            <TabsContent value="side-by-side">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-center text-xs font-medium text-muted-foreground">Foto A</p>
                  <div className="overflow-hidden rounded-lg border">
                    <img
                      src={urlA}
                      alt="Foto A"
                      className="h-auto w-full object-contain"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-center text-xs font-medium text-muted-foreground">Foto B</p>
                  <div className="overflow-hidden rounded-lg border">
                    <img
                      src={urlB}
                      alt="Foto B"
                      className="h-auto w-full object-contain"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Overlay */}
            <TabsContent value="overlay">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Label className="shrink-0 text-xs">Opacidade: {opacity}%</Label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="h-2 w-48 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                  />
                </div>
                <div className="relative overflow-hidden rounded-lg border">
                  <img
                    src={urlA}
                    alt="Foto A"
                    className="h-auto w-full object-contain"
                  />
                  <img
                    src={urlB}
                    alt="Foto B"
                    className="absolute inset-0 h-full w-full object-contain"
                    style={{ opacity: opacity / 100 }}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Slider */}
            <TabsContent value="slider">
              <div
                ref={sliderContainerRef}
                className="relative cursor-col-resize select-none overflow-hidden rounded-lg border"
              >
                {/* Right image (Photo B) - full width background */}
                <img
                  src={urlB}
                  alt="Foto B"
                  className="h-auto w-full object-contain"
                  draggable={false}
                />

                {/* Left image (Photo A) - clipped by slider position */}
                <div
                  className="absolute inset-0"
                  style={{
                    clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
                  }}
                >
                  <img
                    src={urlA}
                    alt="Foto A"
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                </div>

                {/* Divider line */}
                <div
                  className="absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]"
                  style={{ left: `${sliderPosition}%` }}
                >
                  {/* Drag handle */}
                  <div
                    className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-primary shadow-lg"
                    onMouseDown={handleSliderMouseDown}
                    onTouchStart={handleSliderMouseDown}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="text-white"
                    >
                      <path
                        d="M4 3L1 7L4 11M10 3L13 7L10 11"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>

                {/* Labels */}
                <div className="absolute top-2 left-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
                  A
                </div>
                <div className="absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
                  B
                </div>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
