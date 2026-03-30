import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PacientesPageClient } from './pacientes-page-client'

export const metadata: Metadata = {
  title: 'Pacientes | FloraClin',
}

export default function PacientesPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground">Carregando...</div>}>
      <PacientesPageClient />
    </Suspense>
  )
}
