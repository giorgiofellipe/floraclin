import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'
import { PacotesPageClient } from './pacotes-page-client'

export const metadata: Metadata = {
  title: 'Modelos de Pacote | FloraClin',
}

export default async function PacotesPage() {
  // Owner-only: package templates affect pricing for the whole tenant.
  await requireRole('owner')
  return <PacotesPageClient />
}
