import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AgendaPageClient } from './agenda-page-client'
import AgendaLoading from './loading'

export const metadata: Metadata = {
  title: 'Agenda | FloraClin',
}

export default function AgendaPage() {
  return (
    <Suspense fallback={<AgendaLoading />}>
      <AgendaPageClient />
    </Suspense>
  )
}
