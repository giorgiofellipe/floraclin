'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Auth error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-petal">
          <AlertTriangle className="size-8 text-amber" />
        </div>
        <h2 className="text-2xl font-semibold text-forest">
          Algo deu errado
        </h2>
        <p className="max-w-md text-sm text-mid">
          Ocorreu um erro inesperado. Tente novamente ou entre em contato com o
          suporte caso o problema persista.
        </p>
      </div>
      <Button
        onClick={reset}
        className="bg-forest text-cream hover:bg-sage"
      >
        Tentar novamente
      </Button>
    </div>
  )
}
