'use client'

import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { formatRelativeSaveTime } from '@/lib/relative-time'

export interface SaveStatusIndicatorProps {
  isSaving: boolean
  isDirty: boolean
  lastSavedAt: Date | null
  errorType: 'validation' | 'precondition' | 'server' | null
  now: Date
}

export function SaveStatusIndicator({ isSaving, isDirty, lastSavedAt, errorType, now }: SaveStatusIndicatorProps) {
  if (isSaving) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-mid">
        <Loader2 className="size-3 animate-spin text-mid" />
        <span>Salvando...</span>
      </div>
    )
  }
  if (errorType === 'server') {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-red-600">
        <AlertCircle className="size-3" />
        <span>Erro ao salvar</span>
      </div>
    )
  }
  if (isDirty) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-amber-700">
        <span className="inline-block size-1.5 rounded-full bg-amber-500" />
        <span>Alterações não salvas</span>
      </div>
    )
  }
  if (lastSavedAt) {
    return (
      <div data-testid="save-status-indicator" className="hidden md:flex items-center gap-1.5 text-[12px] text-sage">
        <Check className="size-3" />
        <span>{formatRelativeSaveTime(lastSavedAt, now)}</span>
      </div>
    )
  }
  return null
}
