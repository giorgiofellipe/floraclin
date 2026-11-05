'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { installStrokeDataGuard } from './signature-pad-guard'

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
  const [isEmpty, setIsEmpty] = useState(!initialData)

  const resizeCanvas = useCallback(() => {
    if (!containerRef.current || !sigRef.current) return
    if (isDrawingRef.current) {
      pendingResizeRef.current = true
      return
    }

    const canvas = sigRef.current.getCanvas()
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return

    const nextWidth = Math.round(rect.width)
    const nextHeight = Math.round(rect.height)
    if (canvas.width === nextWidth && canvas.height === nextHeight) return

    const snapshot = sigRef.current.isEmpty()
      ? null
      : sigRef.current.toDataURL('image/png')
    canvas.width = nextWidth
    canvas.height = nextHeight
    const restoreFrom = snapshot ?? initialData
    if (restoreFrom) {
      sigRef.current.fromDataURL(restoreFrom)
    }
  }, [initialData])

  useEffect(() => {
    const pad = sigRef.current
    if (!pad) return
    return installStrokeDataGuard(pad.getSignaturePad())
  }, [])

  useEffect(() => {
    if (!sigRef.current) return
    if (initialData) {
      if (isDrawingRef.current) return
      sigRef.current.fromDataURL(initialData)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- setIsEmpty mirrors the imperative canvas state after load; intentional
      setIsEmpty(false)
    } else if (!sigRef.current.isEmpty()) {
      sigRef.current.clear()
      setIsEmpty(true)
    }
  }, [initialData])

  useEffect(() => {
    resizeCanvas()
    const container = containerRef.current
    const observer =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resizeCanvas())
        : null
    if (container && observer) observer.observe(container)
    window.addEventListener('resize', resizeCanvas)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [resizeCanvas])

  const handleBegin = useCallback(() => {
    isDrawingRef.current = true
  }, [])

  const handleEnd = useCallback(() => {
    isDrawingRef.current = false
    if (sigRef.current && !sigRef.current.isEmpty()) {
      setIsEmpty(false)
      onSignatureChange(sigRef.current.toDataURL('image/png'))
    }
    if (pendingResizeRef.current) {
      pendingResizeRef.current = false
      resizeCanvas()
    }
  }, [onSignatureChange, resizeCanvas])

  const handleClear = useCallback(() => {
    if (sigRef.current) {
      isDrawingRef.current = false
      pendingResizeRef.current = false
      sigRef.current.clear()
      setIsEmpty(true)
      onSignatureChange(null)
    }
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
          // Android Chrome fires window.resize when the toolbar hides; the
          // wrapper's default clearOnResize calls clear() mid-stroke and
          // signature_pad 2.3.2 then throws on touchmove (FLORACLIN-1X).
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
