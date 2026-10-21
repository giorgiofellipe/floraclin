'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'

/**
 * For pages that exist only to create or edit (the atendimento wizard): in
 * read-only mode they show why instead of a form whose every save would fail
 * with a 402. Reached by URL, bookmarks or an old "Editar" link.
 */
export function ReadOnlyPage({
  children,
  backHref,
  backLabel,
}: {
  children: ReactNode
  backHref: string
  backLabel: string
}) {
  const { readOnly, openPaywall } = useSubscriptionAccess()
  if (!readOnly) return <>{children}</>
  return (
    <div
      data-testid="read-only-page"
      className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-topbar-border bg-white p-8 text-center"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-petal" aria-hidden>
        <LockIcon className="size-5 text-forest" />
      </div>
      <h1 className="text-lg font-semibold text-charcoal">Modo leitura</h1>
      <p className="text-sm text-charcoal/80">
        Registrar ou editar atendimentos precisa de uma assinatura ativa. O histórico do paciente continua disponível
        para consulta e exportação.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" render={<Link href={backHref} />}>
          {backLabel}
        </Button>
        <Button className="bg-forest text-cream hover:bg-sage" onClick={openPaywall}>
          Ver planos
        </Button>
      </div>
    </div>
  )
}
