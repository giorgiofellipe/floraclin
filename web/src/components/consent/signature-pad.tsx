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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- setIsEmpty mirrors the imperative canvas state after load; intentional
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
          canvasProps={{
            className: 'absolute inset-0 w-full h-full rounded-[3px] cursor-crosshair',
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
            className="border-forest/30 text-forest hover:bg-petal text-xs"
          >
            Limpar assinatura
          </Button>
        </div>
      )}
    </div>
  )
}
