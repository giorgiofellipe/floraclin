'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SignaturePadProps {
  onSignatureChange: (data: string | null) => void
  initialData?: string | null
  disabled?: boolean
  className?: string
}

export function SignaturePad({
  onSignatureChange,
  initialData,
  disabled = false,
  className,
}: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDrawingRef = useRef(false)
  const pendingResizeRef = useRef(false)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seededRef = useRef(false)
  // Capture the seed at mount. Parent echoes of toDataURL after a stroke must
  // not reload the canvas — signature_pad 2.3.2 crashes in _strokeUpdate when
  // _data is cleared while a throttled touchmove is still in flight.
  const seedDataRef = useRef(initialData)
  const [isEmpty, setIsEmpty] = useState(!initialData)

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current
    const pad = sigRef.current
    if (!container || !pad) return
    if (isDrawingRef.current) {
      pendingResizeRef.current = true
      return
    }

    const canvas = pad.getCanvas()
    const rect = container.getBoundingClientRect()
    const cssWidth = Math.round(rect.width)
    const cssHeight = Math.round(rect.height)
    if (cssWidth < 1 || cssHeight < 1) return

    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const nextWidth = Math.round(cssWidth * ratio)
    const nextHeight = Math.round(cssHeight * ratio)
    if (canvas.width === nextWidth && canvas.height === nextHeight) return

    const snapshot = pad.isEmpty() ? null : pad.toDataURL('image/png')
    canvas.width = nextWidth
    canvas.height = nextHeight
    canvas.getContext('2d')?.scale(ratio, ratio)
    if (snapshot) pad.fromDataURL(snapshot)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    resizeCanvas()

    const cancelPendingResize = () => {
      if (resizeTimerRef.current != null) {
        clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resizeCanvas)
      return () => {
        window.removeEventListener('resize', resizeCanvas)
        cancelPendingResize()
      }
    }

    const observer = new ResizeObserver(() => resizeCanvas())
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelPendingResize()
    }
  }, [resizeCanvas])

  useEffect(() => {
    const seed = seedDataRef.current
    if (seededRef.current || !seed || !sigRef.current) return
    sigRef.current.fromDataURL(seed)
    seededRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setIsEmpty mirrors the imperative canvas state after load; intentional
    setIsEmpty(false)
  }, [])

  const handleBegin = useCallback(() => {
    isDrawingRef.current = true
  }, [])

  const handleEnd = useCallback(() => {
    isDrawingRef.current = false
    if (pendingResizeRef.current) {
      pendingResizeRef.current = false
      if (resizeTimerRef.current != null) clearTimeout(resizeTimerRef.current)
      // signature_pad throttles touchmove with setTimeout(16ms). Wait it out
      // so a late _strokeUpdate cannot run against a resized/cleared bitmap.
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        if (!isDrawingRef.current) resizeCanvas()
      }, 32)
    }
    const pad = sigRef.current
    if (pad && !pad.isEmpty()) {
      setIsEmpty(false)
      onSignatureChange(pad.toDataURL('image/png'))
    }
  }, [onSignatureChange, resizeCanvas])

  const handleClear = useCallback(() => {
    if (!sigRef.current) return
    isDrawingRef.current = false
    pendingResizeRef.current = false
    if (resizeTimerRef.current != null) {
      clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = null
    }
    sigRef.current.clear()
    seededRef.current = false
    setIsEmpty(true)
    onSignatureChange(null)
  }, [onSignatureChange])

  if (disabled && initialData) {
    return (
      <div className={cn('rounded-[3px] border border-sage/15 bg-[#F0F7F1] p-3', className)}>
        <img
          src={initialData}
          alt="Assinatura"
          className="h-32 w-full object-contain"
        />
      </div>
    )
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      <div
        ref={containerRef}
        className="relative h-44 w-full rounded-[3px] border-2 border-dashed border-blush bg-gradient-to-b from-white to-[#F4F6F8] transition-colors duration-150 hover:border-sage/40"
      >
        {isEmpty && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg text-mid/40 italic">
              Assinar aqui
            </span>
          </div>
        )}
        <SignatureCanvas
          ref={sigRef}
          penColor="#1C2B1E"
          clearOnResize={false}
          canvasProps={{
            className: 'absolute inset-0 w-full h-full rounded-[3px] cursor-crosshair',
          }}
          onBegin={handleBegin}
          onEnd={handleEnd}
        />
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={isEmpty}
            className="border-forest/30 text-forest hover:bg-petal text-xs"
          >
            Limpar assinatura
          </Button>
        </div>
      )}
    </div>
  )
}
