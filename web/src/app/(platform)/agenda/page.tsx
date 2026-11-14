import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AgendaPageClient } from './agenda-page-client'
import AgendaLoading from './loading'
import { getAuthContext } from '@/lib/auth'
import { getTrialUsage } from '@/db/queries/trial-recap'

export const metadata: Metadata = {
  title: 'Agenda | FloraClin',
}

export default async function AgendaPage() {
  const ctx = await getAuthContext()
  const { hasAppointment } = await getTrialUsage(ctx.tenantId)
  return (
    <Suspense fallback={<AgendaLoading />}>
      <AgendaPageClient role={ctx.role} userId={ctx.userId} hasAnyAppointment={hasAppointment} />
    </Suspense>
  )
}
