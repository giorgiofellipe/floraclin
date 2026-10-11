import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AgendaPageClient } from './agenda-page-client'
import AgendaLoading from './loading'
import { getAuthContext } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Agenda | FloraClin',
}

export default async function AgendaPage() {
  const ctx = await getAuthContext()
  return (
    <Suspense fallback={<AgendaLoading />}>
      <AgendaPageClient role={ctx.role} userId={ctx.userId} />
    </Suspense>
  )
}
