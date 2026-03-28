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
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    if (initialData && sigRef.current) {
      sigRef.current.fromDataURL(initialData)
      setIsEmpty(false)
    }
  }, [initialData])

  // Resize canvas to fit container
  useEffect(() => {
    const resizeCanvas = () => {
      if (!containerRef.current || !sigRef.current) return
      const canvas = sigRef.current.getCanvas()
      const rect = containerRef.current.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
      if (initialData) {
        sigRef.current.fromDataURL(initialData)
      }
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [initialData])

  const handleEnd = useCallback(() => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      setIsEmpty(false)
      onSignatureChange(sigRef.current.toDataURL('image/png'))
    }
  }, [onSignatureChange])

  const handleClear = useCallback(() => {
    if (sigRef.current) {
      sigRef.current.clear()
      setIsEmpty(true)
      onSignatureChange(null)
    }
  }, [onSignatureChange])

  if (disabled && initialData) {
    return (
      <div className={cn('rounded-lg border bg-muted/30 p-2', className)}>
        <img
          src={initialData}
          alt="Assinatura"
          className="h-32 w-full object-contain"
        />
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={containerRef}
        className="relative h-40 w-full rounded-lg border-2 border-dashed border-input bg-background"
      >
        {isEmpty && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Assinar aqui
          </div>
        )}
        <SignatureCanvas
          ref={sigRef}
          penColor="#1a1a1a"
          canvasProps={{
            className: 'absolute inset-0 w-full h-full rounded-lg cursor-crosshair',
          }}
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
          >
            Limpar assinatura
          </Button>
        </div>
      )}
    </div>
  )
}
