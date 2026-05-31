'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Loader2, SwitchCamera, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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

interface CaptureContentProps {
  active: boolean
  patientId: string
  onCaptured?: (photoId: string) => void
  onClose?: () => void
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
const PITCH_TOLERANCE = 22

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

  if (Math.abs(rotation.pitch) > PITCH_TOLERANCE) {
    if (rotation.pitch > 0) {
      hints.push('Levante o queixo')
    } else {
      hints.push('Abaixe o queixo')
    }
  }

  const faceSize = boundingBox.height
  if (faceSize < FACE_SIZE_MIN) {
    hints.push('Aproxime-se da câmera')
  } else if (faceSize > FACE_SIZE_MAX) {
    hints.push('Afaste-se da câmera')
  }

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

// ─── Auto-take ────────────────────────────────────────────────────

const AUTO_TAKE_KEY = 'floraclin:auto-capture'
const AUTO_TAKE_DELAY_MS = 1500

// ─── CaptureContent ───────────────────────────────────────────────

export function CaptureContent({
  active,
  patientId,
  onCaptured,
  onClose,
}: CaptureContentProps) {
  const [selectedPose, setSelectedPose] = useState<PoseKey>('front')
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [detection, setDetection] = useState<FaceDetectionResult | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isMirrored, setIsMirrored] = useState(false)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [cameraIndex, setCameraIndex] = useState(0)
  const [autoTake, setAutoTake] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem(AUTO_TAKE_KEY)
    return stored === null ? true : stored === '1'
  })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraDevicesRef = useRef<MediaDeviceInfo[]>([])
  const rafIdRef = useRef<number | null>(null)
  const lastDetectionTimeRef = useRef(0)

  // Refs for auto-take (used inside detection loop to avoid stale closures)
  const autoTakeRef = useRef(autoTake)
  autoTakeRef.current = autoTake
  const isCapturingRef = useRef(false)
  const alignedSinceRef = useRef<number | null>(null)
  const selectedPoseRef = useRef(selectedPose)
  selectedPoseRef.current = selectedPose
  const handleCaptureRef = useRef<() => void>(() => {})

  const pose = POSES.find((p) => p.key === selectedPose) ?? POSES[0]
  const alignment = checkAlignment(detection, pose)

  const toggleAutoTake = useCallback((checked: boolean) => {
    setAutoTake(checked)
    localStorage.setItem(AUTO_TAKE_KEY, checked ? '1' : '0')
    if (!checked) alignedSinceRef.current = null
  }, [])

  // ── Camera setup ──────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setCameraReady(false)

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Câmera não disponível. Use HTTPS ou um navegador compatível.')
        return
      }

      if (cameraDevicesRef.current.length === 0) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true })
        tempStream.getTracks().forEach((t) => t.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        cameraDevicesRef.current = devices.filter((d) => d.kind === 'videoinput')
        setHasMultipleCameras(cameraDevicesRef.current.length > 1)
      }

      const targetDevice = cameraDevicesRef.current[cameraIndex]
      const constraints: MediaStreamConstraints = {
        video: targetDevice
          ? { deviceId: { exact: targetDevice.deviceId }, width: { ideal: 1920 } }
          : { width: { ideal: 1920 } },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const track = stream.getVideoTracks()[0]
      const facing = track?.getSettings().facingMode
      setIsMirrored(facing !== 'environment')

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
  }, [cameraIndex])

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
    alignedSinceRef.current = null
  }, [])

  useEffect(() => {
    if (active) {
      startCamera()
    } else {
      stopCamera()
      disposeLandmarker()
    }
    return () => {
      stopCamera()
    }
  }, [active, startCamera, stopCamera])

  // ── Capture handler ───────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !detection || isCapturingRef.current) return

    setIsCapturing(true)
    isCapturingRef.current = true
    alignedSinceRef.current = null
    video.pause()

    try {
      const blob = await captureFrameToBlob(video)
      if (!blob) {
        throw new Error('Falha ao capturar frame da câmera')
      }

      const file = new File([blob], `captura-${selectedPoseRef.current}-${Date.now()}.jpg`, {
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
      isCapturingRef.current = false
      if (videoRef.current) {
        videoRef.current.play().catch(() => {})
      }
    }
  }, [detection, patientId, onCaptured])

  handleCaptureRef.current = handleCapture

  // ── Detection loop (with inline auto-take check) ──────────────────

  useEffect(() => {
    if (!active || !cameraReady) return

    let cancelled = false
    const THROTTLE_MS = 66

    function loop() {
      if (cancelled) return

      const now = performance.now()
      if (now - lastDetectionTimeRef.current >= THROTTLE_MS) {
        lastDetectionTimeRef.current = now

        const video = videoRef.current
        if (video && video.readyState >= 2) {
          detectFaceFromVideo(video, now)
            .then((result) => {
              if (cancelled) return
              setDetection(result)

              if (autoTakeRef.current && !isCapturingRef.current) {
                const currentPose = POSES.find((p) => p.key === selectedPoseRef.current) ?? POSES[0]
                const a = checkAlignment(result, currentPose)
                if (a.aligned) {
                  if (!alignedSinceRef.current) {
                    alignedSinceRef.current = now
                  } else if (now - alignedSinceRef.current >= AUTO_TAKE_DELAY_MS) {
                    alignedSinceRef.current = null
                    handleCaptureRef.current()
                  }
                } else {
                  alignedSinceRef.current = null
                }
              }
            })
            .catch(() => {})
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
  }, [active, cameraReady])

  // ── Render ────────────────────────────────────────────────────────

  const guideColor = alignment.aligned ? '#22c55e' : '#eab308'
  const offsetX = getGuideOffsetX(selectedPose)

  return (
    <>
      {/* Pose selector tabs */}
      <div className="shrink-0 flex gap-1 px-4 pb-2 overflow-x-auto">
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
      <div className="relative min-h-0 flex-1 w-full bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={isMirrored ? { transform: 'scaleX(-1)' } : undefined}
        />

        {isCapturing && (
          <div className="absolute inset-0 z-20 flex items-end justify-center pb-6">
            <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 backdrop-blur-sm">
              <Loader2 className="size-4 animate-spin text-white" />
              <span className="text-sm font-medium text-white">Enviando foto...</span>
            </div>
          </div>
        )}

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

        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Loader2 className="size-8 animate-spin text-white" />
            <p className="mt-2 text-xs text-white/80">Inicializando câmera...</p>
          </div>
        )}

        {cameraReady && (
          <div
            className="pointer-events-none absolute inset-0"
            style={isMirrored ? { transform: 'scaleX(-1)' } : undefined}
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 300 400"
              preserveAspectRatio="xMidYMid meet"
            >
              <ellipse
                cx={150 + offsetX}
                cy={190}
                rx={82}
                ry={110}
                fill="none"
                stroke={guideColor}
                strokeWidth={2}
                strokeDasharray="8 4"
                opacity={0.8}
              />
              <line
                x1={150 + offsetX - 70}
                y1={165}
                x2={150 + offsetX + 70}
                y2={165}
                stroke={guideColor}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.6}
              />
              <line
                x1={150 + offsetX}
                y1={78}
                x2={150 + offsetX}
                y2={302}
                stroke={guideColor}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.4}
              />
            </svg>
          </div>
        )}

        {cameraReady && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2">
            <div
              className={cn(
                'rounded-full px-3 py-1 text-sm sm:text-xs font-medium shadow-md backdrop-blur-sm',
                alignment.aligned
                  ? 'bg-green-500/90 text-white'
                  : 'bg-yellow-500/90 text-black',
              )}
            >
              {alignment.aligned
                ? autoTake
                  ? 'Capturando automaticamente...'
                  : 'Posição ideal'
                : 'Ajustando posição...'}
            </div>
          </div>
        )}

        {cameraReady && !alignment.aligned && alignment.hints.length > 0 && (
          <div className="absolute bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2">
            <div className="flex flex-col items-center gap-1 rounded-lg bg-black/60 px-4 py-2 backdrop-blur-sm">
              {alignment.hints.map((hint) => (
                <p
                  key={hint}
                  className="text-sm sm:text-xs font-medium text-yellow-300"
                >
                  {hint}
                </p>
              ))}
            </div>
          </div>
        )}

        {hasMultipleCameras && cameraReady && (
          <button
            type="button"
            onClick={() => setCameraIndex((i) => (i + 1) % cameraDevicesRef.current.length)}
            disabled={isCapturing}
            className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white disabled:opacity-50"
          >
            <SwitchCamera className="size-5" />
          </button>
        )}
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-mid cursor-pointer">
            <Switch
              size="sm"
              checked={autoTake}
              onCheckedChange={toggleAutoTake}
            />
            Captura automática
          </label>
          <div className="flex items-center gap-2">
            {onClose && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={isCapturing}
              >
                Cancelar
              </Button>
            )}
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
        </div>
      </div>
    </>
  )
}

// ─── Dialog wrapper (standalone usage) ─────────────────────────────

export function CapturePoseGuide({
  open,
  onOpenChange,
  patientId,
  onCaptured,
}: CapturePoseGuideProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl sm:max-w-2xl max-h-[100dvh] p-0 overflow-hidden flex flex-col"
        showCloseButton={true}
      >
        <DialogHeader className="shrink-0 px-4 pt-4 pb-2">
          <DialogTitle>Captura com Guia de Pose</DialogTitle>
        </DialogHeader>
        <CaptureContent
          active={open}
          patientId={patientId}
          onCaptured={onCaptured}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
