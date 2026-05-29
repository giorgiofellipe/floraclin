import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AniversariantesPageClient } from './aniversariantes-page-client'

export const metadata: Metadata = {
  title: 'Aniversariantes | FloraClin',
}

export default function AniversariantesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <AniversariantesPageClient />
    </Suspense>
  )
}
