import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ProfessionalSignatureBlockProps {
  signatureDataUrl: string
  displayName: string
  registryLine: string
  className?: string
}

export function ProfessionalSignatureBlock({
  signatureDataUrl,
  displayName,
  registryLine,
  className,
}: ProfessionalSignatureBlockProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- dataURL, no remote fetch */}
      <img
        src={signatureDataUrl}
        alt={`Assinatura de ${displayName}`}
        className="h-24 max-w-[280px] object-contain"
      />
      <div className="mt-1 w-[280px] border-t border-black" />
      <div className="mt-2 text-sm font-medium">{displayName}</div>
      <div className="text-xs text-gray-700">{registryLine}</div>
    </div>
  )
}
