'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Loader2, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import * as Sentry from '@sentry/nextjs'
import {
  detectFaceFromVideo,
  disposeLandmarker,
  type FaceDetectionResult,
} from '@/lib/face-detection'
import { computeAutoCrop } from '@/lib/face-alignment'

// ─── Types ──────────────────────────────────────────────────────────

interface CapturePoseGuideProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  onCaptured?: (photoId: string) => void
}

type PoseKey = 'front' | 'left45' | 'leftProfile' | 'right45' | 'rightProfile'

interface Pose {
  key: PoseKey
  label: string
  yawRange: readonly [number, number]
}

// ─── Pose configuration ────────────────────────────────────────────

const POSES: readonly Pose[] = [
  { key: 'front', label: 'Frontal', yawRange: [-8, 8] as const },
  { key: 'left45', label: '45° Esq.', yawRange: [30, 55] as const },
  { key: 'leftProfile', label: 'Perfil Esq.', yawRange: [65, 90] as const },
  { key: 'right45', label: '45° Dir.', yawRange: [-55, -30] as const },
  { key: 'rightProfile', label: 'Perfil Dir.', yawRange: [-90, -65] as const },
] as const

// ─── Alignment helpers ─────────────────────────────────────────────

const FACE_SIZE_MIN = 0.40
const FACE_SIZE_MAX = 0.70
const CENTER_TOLERANCE = 0.10
const PITCH_TOLERANCE = 15

interface AlignmentStatus {
  aligned: boolean
  hints: string[]
}

function checkAlignment(
  detection: FaceDetectionResult | null,
  pose: Pose,
): AlignmentStatus {
  if (!detection) {
    return { aligned: false, hints: ['Nenhum rosto detectado'] }
  }

  const { rotation, boundingBox } = detection
  const hints: string[] = []

  // Check yaw range
  const [yawMin, yawMax] = pose.yawRange
  if (rotation.yaw < yawMin) {
    if (yawMin >= 0) {
      hints.push('Vire mais para a esquerda')
    } else {
      hints.push('Vire mais para a direita')
    }
  } else if (rotation.yaw > yawMax) {
    if (yawMax <= 0) {
      hints.push('Vire mais para a esquerda')
    } else {
      hints.push('Vire mais para a direita')
    }
  }

  // Check pitch
  if (Math.abs(rotation.pitch) > PITCH_TOLERANCE) {
    if (rotation.pitch > 0) {
      hints.push('Abaixe o queixo')
    } else {
      hints.push('Levante o queixo')
    }
  }

  // Check face size relative to guide (use height as proxy)
  const faceSize = boundingBox.height
  if (faceSize < FACE_SIZE_MIN) {
    hints.push('Aproxime-se da câmera')
  } else if (faceSize > FACE_SIZE_MAX) {
    hints.push('Afaste-se da câmera')
  }

  // Check centering
  const faceCenterX = boundingBox.x + boundingBox.width / 2
  const faceCenterY = boundingBox.y + boundingBox.height / 2
  if (Math.abs(faceCenterX - 0.5) > CENTER_TOLERANCE) {
    if (faceCenterX < 0.5) {
      hints.push('Mova para a direita')
    } else {
      hints.push('Mova para a esquerda')
    }
  }
  if (Math.abs(faceCenterY - 0.5) > CENTER_TOLERANCE) {
    if (faceCenterY < 0.5) {
      hints.push('Mova para baixo')
    } else {
      hints.push('Mova para cima')
    }
  }

  return { aligned: hints.length === 0, hints }
}

// ─── Guide overlay position per pose ──────────────────────────────

function getGuideOffsetX(pose: PoseKey): number {
  switch (pose) {
    case 'left45':
      return -5
    case 'leftProfile':
      return -10
    case 'right45':
      return 5
    case 'rightProfile':
      return 10
    default:
      return 0
  }
}

// ─── Canvas compression ───────────────────────────────────────────

const MAX_CAPTURE_DIMENSION = 2048
const JPEG_QUALITY = 0.85

function captureFrameToBlob(
  video: HTMLVideoElement,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    let { videoWidth: w, videoHeight: h } = video

    // Resize if needed
    if (w > MAX_CAPTURE_DIMENSION || h > MAX_CAPTURE_DIMENSION) {
      const scale = MAX_CAPTURE_DIMENSION / Math.max(w, h)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
    }

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    ctx.drawImage(video, 0, 0, w, h)
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  })
}

// ─── Component ──────────────────────────────────────────────────────

export function CapturePoseGuide({
  open,
  onOpenChange,
  patientId,
  onCaptured,
}: CapturePoseGuideProps) {
  const [selectedPose, setSelectedPose] = useState<PoseKey>('front')
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [detection, setDetection] = useState<FaceDetectionResult | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastDetectionTimeRef = useRef(0)

  const pose = POSES.find((p) => p.key === selectedPose) ?? POSES[0]
  const alignment = checkAlignment(detection, pose)

  // ── Camera setup ──────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setCameraReady(false)

    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 } },
        })
      } catch {
        // Fall back to any camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 } },
        })
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true)
        }
      }
    } catch (err) {
      console.error('[capture-pose-guide] Camera error:', err)
      setCameraError('Não foi possível acessar a câmera. Verifique as permissões.')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraReady(false)
    setDetection(null)
  }, [])

  // Start/stop camera when dialog opens/closes
  useEffect(() => {
    if (open) {
      startCamera()
    } else {
      stopCamera()
      disposeLandmarker()
    }
    return () => {
      stopCamera()
    }
  }, [open, startCamera, stopCamera])

  // ── Detection loop ────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !cameraReady) return

    let cancelled = false
    const THROTTLE_MS = 66 // ~15fps

    function loop() {
      if (cancelled) return

      const now = performance.now()
      if (now - lastDetectionTimeRef.current >= THROTTLE_MS) {
        lastDetectionTimeRef.current = now

        const video = videoRef.current
        if (video && video.readyState >= 2) {
          detectFaceFromVideo(video, now)
            .then((result) => {
              if (!cancelled) {
                setDetection(result)
              }
            })
            .catch(() => {
              // Swallow detection errors — frame-level failures are normal
            })
        }
      }

      rafIdRef.current = requestAnimationFrame(loop)
    }

    rafIdRef.current = requestAnimationFrame(loop)

    return () => {
      cancelled = true
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [open, cameraReady])

  // ── Capture handler ───────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !detection || isCapturing) return

    setIsCapturing(true)

    try {
      // 1. Capture frame
      const blob = await captureFrameToBlob(video)
      if (!blob) {
        throw new Error('Falha ao capturar frame da câmera')
      }

      // 2. Upload as photo
      const file = new File([blob], `captura-${selectedPose}-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      })

      const formData = new FormData()
      formData.set('file', file)
      formData.set('patientId', patientId)
      formData.set('timelineStage', 'pre')

      const uploadRes = await fetch('/api/photos', {
        method: 'POST',
        body: formData,
      })

      const contentType = uploadRes.headers.get('content-type') ?? ''
      let uploadResult: { success?: boolean; error?: string; data?: { id?: string } }
      if (contentType.includes('application/json')) {
        uploadResult = await uploadRes.json()
      } else {
        uploadResult = uploadRes.ok
          ? { success: true }
          : { success: false, error: `HTTP ${uploadRes.status}` }
      }

      if (!uploadResult.success || !uploadResult.data?.id) {
        throw new Error(uploadResult.error ?? 'Erro ao enviar foto')
      }

      const photoId = uploadResult.data.id

      // 3. Save crop + landmarks via PATCH
      const crop = computeAutoCrop(detection, '3:4')
      const cropBox = {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        rotation: 0,
        aspect: '3:4' as const,
        landmarks: detection.landmarks,
      }

      await fetch(`/api/photos/${photoId}/crop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropBox }),
      })

      toast.success('Foto capturada com sucesso!')
      onCaptured?.(photoId)
    } catch (err) {
      console.error('[capture-pose-guide] Capture error:', err)
      Sentry.captureException(err)
      toast.error('Erro ao capturar foto. Tente novamente.')
    } finally {
      setIsCapturing(false)
    }
  }, [detection, isCapturing, patientId, selectedPose, onCaptured])

  // ── Render ────────────────────────────────────────────────────────

  const guideColor = alignment.aligned ? '#22c55e' : '#eab308'
  const offsetX = getGuideOffsetX(selectedPose)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl sm:max-w-2xl p-0 overflow-hidden"
        showCloseButton={true}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Captura com Guia de Pose</DialogTitle>
        </DialogHeader>

        {/* Pose selector tabs */}
        <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
          {POSES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelectedPose(p.key)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                selectedPose === p.key
                  ? 'bg-forest text-cream'
                  : 'bg-[#F4F6F8] text-mid hover:bg-[#E8ECEF] hover:text-charcoal',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Camera viewport */}
        <div className="relative aspect-[3/4] w-full bg-black overflow-hidden">
          {/* Video element */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {/* Camera error */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
              <VideoOff className="mb-3 size-10 text-red-400" />
              <p className="text-sm text-white">{cameraError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={startCamera}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {/* Loading state */}
          {!cameraReady && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
              <Loader2 className="size-8 animate-spin text-white" />
              <p className="mt-2 text-xs text-white/80">Inicializando câmera...</p>
            </div>
          )}

          {/* Guide overlay */}
          {cameraReady && (
            <div className="pointer-events-none absolute inset-0">
              {/* Face outline oval */}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 300 400"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Face oval */}
                <ellipse
                  cx={150 + offsetX}
                  cy={185}
                  rx={65}
                  ry={88}
                  fill="none"
                  stroke={guideColor}
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  opacity={0.8}
                />
                {/* Eye-level line */}
                <line
                  x1={150 + offsetX - 55}
                  y1={165}
                  x2={150 + offsetX + 55}
                  y2={165}
                  stroke={guideColor}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.6}
                />
                {/* Center vertical line */}
                <line
                  x1={150 + offsetX}
                  y1={95}
                  x2={150 + offsetX}
                  y2={275}
                  stroke={guideColor}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.4}
                />
              </svg>

              {/* Status indicator */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2">
                <div
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium shadow-md backdrop-blur-sm',
                    alignment.aligned
                      ? 'bg-green-500/90 text-white'
                      : 'bg-yellow-500/90 text-black',
                  )}
                >
                  {alignment.aligned ? 'Posição ideal' : 'Ajustando posição...'}
                </div>
              </div>

              {/* Directional hints */}
              {!alignment.aligned && alignment.hints.length > 0 && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
                  <div className="flex flex-col items-center gap-1 rounded-lg bg-black/60 px-4 py-2 backdrop-blur-sm">
                    {alignment.hints.map((hint) => (
                      <p
                        key={hint}
                        className="text-xs font-medium text-yellow-300"
                      >
                        {hint}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-center gap-4 px-4 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isCapturing}
          >
            Cancelar
          </Button>

          <Button
            size="lg"
            className={cn(
              'gap-2 rounded-full px-8 transition-colors',
              alignment.aligned
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-muted text-muted-foreground',
            )}
            disabled={!alignment.aligned || isCapturing || !cameraReady}
            onClick={handleCapture}
          >
            {isCapturing ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Capturando...
              </>
            ) : (
              <>
                <Camera className="size-5" />
                Capturar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
