'use client'

import { AlertCircle } from 'lucide-react'
import type { UseFormReturn, FieldValues } from 'react-hook-form'

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>
  onRetry?: () => void
}

export function FormServerErrorBanner<T extends FieldValues>({ form, onRetry }: Props<T>) {
  const root = (form.formState.errors as Record<string, { serverError?: { message?: string } }>).root
  const serverError = root?.serverError?.message
  if (!serverError) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">Erro ao salvar</p>
        <p className="text-red-700">{serverError}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-sm font-medium text-red-800 underline hover:text-red-900">
          Tentar novamente
        </button>
      )}
    </div>
  )
}
