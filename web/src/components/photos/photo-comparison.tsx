'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X, RotateCcw, Eye, Check, PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { cn, formatDate } from '@/lib/utils'
import { computeAlignmentTransform, alignmentTransformToCssMatrix, computeAutoCrop } from '@/lib/face-alignment'
import { autoDetectAndSaveCrop } from '@/lib/auto-crop'
import type { PhotoCropData } from '@/validations/photo-crop'
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
  const [alignmentOn, setAlignmentOn] = useState(true)
  const [cropBoxA, setCropBoxA] = useState<PhotoCropData | null>(null)
  const [cropBoxB, setCropBoxB] = useState<PhotoCropData | null>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [markingEyes, setMarkingEyes] = useState<'A' | 'B' | null>(null)
  const [eyeClicks, setEyeClicks] = useState<Array<{ x: number; y: number }>>([])

  const needsLandmarksA = !!cropBoxA && !cropBoxA.landmarks
  const needsLandmarksB = !!cropBoxB && !cropBoxB.landmarks

  const handleEyeClick = useCallback((e: React.MouseEvent<HTMLDivElement>, side: 'A' | 'B') => {
    if (markingEyes !== side) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return

    const crop = side === 'A' ? cropBoxA : cropBoxB
    const imgNx = crop ? crop.x + nx * crop.width : nx
    const imgNy = crop ? crop.y + ny * crop.height : ny

    const clicks = [...eyeClicks, { x: imgNx, y: imgNy }]
    setEyeClicks(clicks)

    if (clicks.length >= 2) {
      finalizeLandmarks(clicks, side)
    }
  }, [markingEyes, eyeClicks, cropBoxA, cropBoxB, photoA, photoB, imgNaturalSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmSingleEye = useCallback((side: 'A' | 'B') => {
    if (eyeClicks.length === 1) finalizeLandmarks(eyeClicks, side)
  }, [eyeClicks, cropBoxA, cropBoxB, photoA, photoB, imgNaturalSize]) // eslint-disable-line react-hooks/exhaustive-deps

  function finalizeLandmarks(clicks: Array<{ x: number; y: number }>, side: 'A' | 'B') {
    let leftEye: { x: number; y: number }
    let rightEye: { x: number; y: number }
    let noseTip: { x: number; y: number }
    let ipd: number

    if (clicks.length === 1) {
      const eye = clicks[0]
      const estimatedIpd = 0.06
      leftEye = { x: eye.x - estimatedIpd / 2, y: eye.y }
      rightEye = { x: eye.x + estimatedIpd / 2, y: eye.y }
      noseTip = { x: eye.x, y: eye.y + estimatedIpd * 0.6 }
      ipd = estimatedIpd
    } else {
      const [eye1, eye2] = clicks
      leftEye = eye1.x < eye2.x ? eye1 : eye2
      rightEye = eye1.x < eye2.x ? eye2 : eye1
      noseTip = { x: (eye1.x + eye2.x) / 2, y: (eye1.y + eye2.y) / 2 + Math.abs(eye2.x - eye1.x) * 0.6 }
      ipd = Math.sqrt((eye2.x - eye1.x) ** 2 + (eye2.y - eye1.y) ** 2)
    }

    const landmarks = { leftEye, rightEye, noseTip, interPupillaryDistance: ipd }
    const photo = side === 'A' ? photoA : photoB
    const currentCrop = side === 'A' ? cropBoxA : cropBoxB
    if (currentCrop && photo) {
      const bbPad = Math.max(ipd * 1.5, 0.15)
      const manualDetection = {
        landmarks,
        boundingBox: {
          x: Math.max(0, noseTip.x - bbPad),
          y: Math.max(0, leftEye.y - bbPad * 0.8),
          width: Math.min(bbPad * 2, 1),
          height: Math.min(bbPad * 2.5, 1),
        },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        gaze: { leftRatio: 0.5, rightRatio: 0.5 },
      }
      const newCrop = computeAutoCrop(manualDetection, currentCrop.aspect ?? '3:4', imgNaturalSize ? { width: imgNaturalSize.w, height: imgNaturalSize.h } : undefined)
      const updated: PhotoCropData = { ...currentCrop, ...newCrop, landmarks }
      if (side === 'A') setCropBoxA(updated)
      else setCropBoxB(updated)
      fetch(`/api/photos/${photo.id}/crop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropBox: updated }),
      }).catch(() => {})
    }

    setMarkingEyes(null)
    setEyeClicks([])
  }
  const autoDetectAttempted = useRef(new Set<string>())
  const cropBoxARef = useRef(cropBoxA)
  const cropBoxBRef = useRef(cropBoxB)
  cropBoxARef.current = cropBoxA
  cropBoxBRef.current = cropBoxB
  const containerRef = useRef<HTMLDivElement>(null)
  const sliderContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  useEffect(() => {
    if (!open || !photoA || !photoB) {
      setUrlA(null)
      setUrlB(null)
      setCropBoxA(null)
      setCropBoxB(null)
      setSliderPosition(50)
      autoDetectAttempted.current.clear()
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
          setCropBoxA(result.data.cropBoxA ?? null)
          setCropBoxB(result.data.cropBoxB ?? null)
        }
      } finally {
        setLoadingUrls(false)
      }
    }
    loadUrls()
  }, [open, photoA, photoB])

  useEffect(() => {
    if (!urlA || !urlB) return

    type DetectTask = { url: string; id: string; setter: (c: PhotoCropData) => void }
    const tasks: DetectTask[] = []

    if (!cropBoxARef.current && photoA && !autoDetectAttempted.current.has(photoA.id)) {
      autoDetectAttempted.current.add(photoA.id)
      tasks.push({ url: urlA, id: photoA.id, setter: setCropBoxA })
    }
    if (!cropBoxBRef.current && photoB && !autoDetectAttempted.current.has(photoB.id)) {
      autoDetectAttempted.current.add(photoB.id)
      tasks.push({ url: urlB, id: photoB.id, setter: setCropBoxB })
    }

    if (tasks.length === 0) return

    let cancelled = false
    setAutoDetecting(true)

    Promise.all(
      tasks.map(({ url, id, setter }) =>
        autoDetectAndSaveCrop(url, id)
          .then((crop) => { if (!cancelled && crop) setter(crop) })
          .catch(() => {}),
      ),
    ).then(() => { if (!cancelled) setAutoDetecting(false) })

    return () => { cancelled = true }
  }, [urlA, urlB, photoA, photoB])

  useEffect(() => {
    const refUrl = cropBoxA ? urlA : cropBoxB ? urlB : null
    if (!refUrl) { setImgNaturalSize(null); return }
    const img = new Image()
    img.onload = () => setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = refUrl
    return () => { img.onload = null }
  }, [urlA, urlB, cropBoxA, cropBoxB])

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

  const hasLandmarks = !!(cropBoxA?.landmarks && cropBoxB?.landmarks)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [urlA, urlB, mode])

  function toCropRelative(
    landmarks: { leftEye: { x: number; y: number }; rightEye: { x: number; y: number } },
    crop: PhotoCropData,
  ) {
    return {
      leftEye: {
        x: (landmarks.leftEye.x - crop.x) / crop.width,
        y: (landmarks.leftEye.y - crop.y) / crop.height,
      },
      rightEye: {
        x: (landmarks.rightEye.x - crop.x) / crop.width,
        y: (landmarks.rightEye.y - crop.y) / crop.height,
      },
    }
  }

  const alignmentCss = useMemo(() => {
    if (!hasLandmarks || !alignmentOn || !cropBoxA?.landmarks || !cropBoxB?.landmarks)
      return null
    if (containerSize.w === 0 || containerSize.h === 0) return null

    const refLm = toCropRelative(cropBoxA.landmarks, cropBoxA)
    const tgtLm = toCropRelative(cropBoxB.landmarks, cropBoxB)

    const transform = computeAlignmentTransform(
      refLm,
      tgtLm,
      containerSize.w,
      containerSize.h,
    )
    if (!transform) return null
    return alignmentTransformToCssMatrix(transform)
  }, [hasLandmarks, alignmentOn, cropBoxA, cropBoxB, containerSize])

  const cropAspect = useMemo(() => {
    const crop = cropBoxA ?? cropBoxB
    if (!crop) return null
    if (imgNaturalSize) return { w: crop.width * imgNaturalSize.w, h: crop.height * imgNaturalSize.h }
    return { w: crop.width, h: crop.height }
  }, [cropBoxA, cropBoxB, imgNaturalSize])

  function cropImgStyle(crop: PhotoCropData): React.CSSProperties {
    return {
      position: 'absolute',
      width: `${100 / crop.width}%`,
      height: `${100 / crop.height}%`,
      maxWidth: 'none',
      maxHeight: 'none',
      left: `${-(crop.x / crop.width) * 100}%`,
      top: `${-(crop.y / crop.height) * 100}%`,
    }
  }

  const maxVh = 70

  const cropContainerStyle: React.CSSProperties | undefined = useMemo(() => {
    if (!cropAspect) return undefined
    const crop = cropBoxA ?? cropBoxB
    const naturalW = crop && imgNaturalSize ? Math.round(crop.width * imgNaturalSize.w) : null
    const parts = ['100%', `calc(${maxVh}vh * ${cropAspect.w} / ${cropAspect.h})`]
    if (naturalW) parts.push(`${naturalW}px`)
    return { width: `min(${parts.join(', ')})` }
  }, [cropAspect, cropBoxA, cropBoxB, imgNaturalSize, maxVh])

  const [redoing, setRedoing] = useState(false)

  const handleRedoCrop = useCallback(async () => {
    if (!urlA || !urlB || !photoA || !photoB) return
    setRedoing(true)
    try {
      // Clear existing crops on server
      await Promise.all([
        fetch(`/api/photos/${photoA.id}/crop`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropBox: null }),
        }),
        fetch(`/api/photos/${photoB.id}/crop`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropBox: null }),
        }),
      ])
      setCropBoxA(null)
      setCropBoxB(null)
      autoDetectAttempted.current.clear()
      cropBoxARef.current = null
      cropBoxBRef.current = null
      // Re-detect
      const [cropA, cropB] = await Promise.all([
        autoDetectAndSaveCrop(urlA, photoA.id).catch(() => null),
        autoDetectAndSaveCrop(urlB, photoB.id).catch(() => null),
      ])
      if (cropA) setCropBoxA(cropA)
      if (cropB) setCropBoxB(cropB)
    } finally {
      setRedoing(false)
    }
  }, [urlA, urlB, photoA, photoB])

  const labelA = photoA ? getPhotoLabel(photoA) : ''
  const labelB = photoB ? getPhotoLabel(photoB) : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[95vh] overflow-hidden border-0 bg-[#1C2B1E] p-0 [&>button:last-child]:hidden">
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
          <div className="flex items-center gap-2">
            {(cropBoxA || cropBoxB) && (
              <button
                type="button"
                onClick={handleRedoCrop}
                disabled={redoing}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
              >
                <RotateCcw className={cn('size-3.5', redoing && 'animate-spin')} />
                Refazer recorte
              </button>
            )}
            {hasLandmarks && (
              <button
                type="button"
                onClick={() => setAlignmentOn((v) => !v)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  alignmentOn
                    ? 'bg-sage/20 text-sage'
                    : 'text-white/50 hover:text-white/80'
                )}
              >
                <div className={cn(
                  'h-3.5 w-6 rounded-full transition-colors relative',
                  alignmentOn ? 'bg-sage' : 'bg-white/20',
                )}>
                  <div className={cn(
                    'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform',
                    alignmentOn ? 'translate-x-2.5' : 'translate-x-0.5',
                  )} />
                </div>
                Alinhamento automático
              </button>
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

        {/* Manual landmark banner */}
        {!autoDetecting && !loadingUrls && (needsLandmarksA || needsLandmarksB) && (
          <div className="flex items-center justify-between gap-3 mx-4 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="size-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-200/90">
                Não foi possível detectar o rosto automaticamente. Marque os olhos para alinhar.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (cropBoxA?.landmarks) {
                    setMarkingEyes('A'); setEyeClicks([]); setMode('side-by-side')
                  } else {
                    setMarkingEyes(markingEyes === 'A' ? null : 'A'); setEyeClicks([]); setMode('side-by-side')
                  }
                }}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  markingEyes === 'A'
                    ? 'bg-amber-500/30 text-amber-300'
                    : cropBoxA?.landmarks
                      ? 'text-emerald-400/80 hover:text-amber-300 hover:bg-amber-500/10'
                      : 'text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10',
                )}
              >
                {cropBoxA?.landmarks ? <Check className="size-3" /> : <Eye className="size-3" />}
                Foto A
                {cropBoxA?.landmarks && <PencilLine className="size-2.5 ml-0.5 opacity-60" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cropBoxB?.landmarks) {
                    setMarkingEyes('B'); setEyeClicks([]); setMode('side-by-side')
                  } else {
                    setMarkingEyes(markingEyes === 'B' ? null : 'B'); setEyeClicks([]); setMode('side-by-side')
                  }
                }}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  markingEyes === 'B'
                    ? 'bg-amber-500/30 text-amber-300'
                    : cropBoxB?.landmarks
                      ? 'text-emerald-400/80 hover:text-amber-300 hover:bg-amber-500/10'
                      : 'text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10',
                )}
              >
                {cropBoxB?.landmarks ? <Check className="size-3" /> : <Eye className="size-3" />}
                Foto B
                {cropBoxB?.landmarks && <PencilLine className="size-2.5 ml-0.5 opacity-60" />}
              </button>
              {hasLandmarks && (
                <button
                  type="button"
                  onClick={() => { setAlignmentOn(true); setMarkingEyes(null) }}
                  className="flex items-center gap-1 rounded-md bg-sage/20 px-2.5 py-1 text-[11px] font-medium text-sage transition-colors hover:bg-sage/30"
                >
                  Aplicar alinhamento
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="px-4 pb-4">
          {loadingUrls || autoDetecting ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24">
              <Loader2 className="size-6 animate-spin text-white/40" />
              {autoDetecting && (
                <span className="text-xs text-white/40">Detectando rosto...</span>
              )}
            </div>
          ) : !urlA || !urlB ? (
            <div className="flex items-center justify-center py-24">
              <p className="text-sm text-white/40">Erro ao carregar fotos.</p>
            </div>
          ) : (
            <>
              {mode === 'slider' && (
                <div
                  ref={(el) => {
                    containerRef.current = el
                    sliderContainerRef.current = el
                  }}
                  className={cn('relative cursor-col-resize select-none overflow-hidden rounded-lg', cropAspect && 'mx-auto')}
                  style={cropContainerStyle}
                >
                  {cropAspect ? (
                    <svg viewBox={`0 0 ${cropAspect.w} ${cropAspect.h}`} className="block w-full" aria-hidden="true" />
                  ) : (
                    <img src={urlA} alt="" className="block w-full max-h-[70vh] object-contain invisible" aria-hidden="true" />
                  )}

                  {/* Photo B (behind) */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={alignmentCss ? { transform: alignmentCss, transformOrigin: '0 0' } : undefined}
                  >
                    {cropBoxB ? (
                      <img src={urlB} alt="Foto B" draggable={false} style={cropImgStyle(cropBoxB)} />
                    ) : (
                      <img src={urlB} alt="Foto B" className="h-full w-full object-contain" draggable={false} />
                    )}
                  </div>

                  {/* Photo A (front, clipped) */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
                  >
                    {cropBoxA ? (
                      <img src={urlA} alt="Foto A" draggable={false} style={cropImgStyle(cropBoxA)} />
                    ) : (
                      <img src={urlA} alt="Foto A" className="h-full w-full object-contain" draggable={false} />
                    )}
                  </div>

                  {/* Slider handle */}
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
                <div className="grid grid-cols-2 gap-3 items-start">
                  <div className="space-y-2">
                    <div
                      className={cn('relative overflow-hidden rounded-lg', markingEyes === 'A' && 'border-2 border-amber-400 cursor-crosshair')}
                      onClick={(e) => handleEyeClick(e, 'A')}
                    >
                      {cropAspect && cropBoxA ? (
                        <>
                          <svg viewBox={`0 0 ${cropAspect.w} ${cropAspect.h}`} className="block w-full" aria-hidden="true" />
                          <div className="absolute inset-0 overflow-hidden">
                            <img src={urlA} alt="Foto A" style={cropImgStyle(cropBoxA)} />
                          </div>
                        </>
                      ) : (
                        <img src={urlA} alt="Foto A" className="block w-full max-h-[70vh] object-contain" />
                      )}
                      {markingEyes === 'A' && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 z-10">
                          <span className="rounded bg-black/60 px-2.5 py-1 text-[11px] text-white font-medium">
                            {eyeClicks.length === 0 ? 'Clique no olho visível' : 'Clique no 2° olho ou confirme abaixo'}
                          </span>
                          {eyeClicks.length === 1 && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); confirmSingleEye('A') }} className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs text-white font-semibold shadow-lg hover:bg-amber-600 transition-colors">
                              Confirmar
                            </button>
                          )}
                        </div>
                      )}
                      {markingEyes === 'A' && eyeClicks.map((pt, i) => (
                        <div key={i} className="absolute size-3 rounded-full bg-amber-400 border-2 border-amber-600 shadow-md pointer-events-none" style={{
                          left: `${((pt.x - (cropBoxA?.x ?? 0)) / (cropBoxA?.width ?? 1)) * 100}%`,
                          top: `${((pt.y - (cropBoxA?.y ?? 0)) / (cropBoxA?.height ?? 1)) * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }} />
                      ))}
                    </div>
                    <p className="text-center text-[11px] text-white/60">{labelA}</p>
                  </div>
                  <div className="space-y-2">
                    <div
                      ref={containerRef}
                      className={cn('relative overflow-hidden rounded-lg', markingEyes === 'B' && 'border-2 border-amber-400 cursor-crosshair')}
                      onClick={(e) => handleEyeClick(e, 'B')}
                    >
                      {cropAspect ? (
                        <>
                          <svg viewBox={`0 0 ${cropAspect.w} ${cropAspect.h}`} className="block w-full" aria-hidden="true" />
                          <div
                            className="absolute inset-0 overflow-hidden"
                            style={alignmentCss ? { transform: alignmentCss, transformOrigin: '0 0' } : undefined}
                          >
                            {cropBoxB ? (
                              <img src={urlB} alt="Foto B" style={cropImgStyle(cropBoxB)} />
                            ) : (
                              <img src={urlB} alt="Foto B" className="h-full w-full object-contain" />
                            )}
                          </div>
                        </>
                      ) : (
                        <img src={urlB} alt="Foto B" className="block w-full max-h-[70vh] object-contain"
                          style={alignmentCss ? { transform: alignmentCss, transformOrigin: '0 0' } : undefined}
                        />
                      )}
                      {markingEyes === 'B' && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 z-10">
                          <span className="rounded bg-black/60 px-2.5 py-1 text-[11px] text-white font-medium">
                            {eyeClicks.length === 0 ? 'Clique no olho visível' : 'Clique no 2° olho ou confirme abaixo'}
                          </span>
                          {eyeClicks.length === 1 && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); confirmSingleEye('B') }} className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs text-white font-semibold shadow-lg hover:bg-amber-600 transition-colors">
                              Confirmar
                            </button>
                          )}
                        </div>
                      )}
                      {markingEyes === 'B' && eyeClicks.map((pt, i) => (
                        <div key={i} className="absolute size-3 rounded-full bg-amber-400 border-2 border-amber-600 shadow-md pointer-events-none" style={{
                          left: `${((pt.x - (cropBoxB?.x ?? 0)) / (cropBoxB?.width ?? 1)) * 100}%`,
                          top: `${((pt.y - (cropBoxB?.y ?? 0)) / (cropBoxB?.height ?? 1)) * 100}%`,
                          transform: 'translate(-50%, -50%)',
                        }} />
                      ))}
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
                  <div ref={containerRef} className={cn('relative overflow-hidden rounded-lg', cropAspect && 'mx-auto')} style={cropContainerStyle}>
                    {cropAspect ? (
                      <svg viewBox={`0 0 ${cropAspect.w} ${cropAspect.h}`} className="block w-full" aria-hidden="true" />
                    ) : (
                      <img src={urlA} alt="" className="block w-full max-h-[70vh] object-contain invisible" aria-hidden="true" />
                    )}

                    {/* Photo A base */}
                    <div className="absolute inset-0 overflow-hidden">
                      {cropBoxA ? (
                        <img src={urlA} alt="Foto A" style={cropImgStyle(cropBoxA)} />
                      ) : (
                        <img src={urlA} alt="Foto A" className="h-full w-full object-contain" />
                      )}
                    </div>

                    {/* Photo B overlay */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        opacity: opacity / 100,
                        ...(alignmentCss ? { transform: alignmentCss, transformOrigin: '0 0' } : {}),
                      }}
                    >
                      {cropBoxB ? (
                        <img src={urlB} alt="Foto B" style={cropImgStyle(cropBoxB)} />
                      ) : (
                        <img src={urlB} alt="Foto B" className="h-full w-full object-contain" />
                      )}
                    </div>
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
