import type { Metadata } from 'next'
import { requireRole } from '@/lib/auth'
import { DocumentosPageClient } from './documentos-page-client'

export const metadata: Metadata = {
  title: 'Modelos de Documentos | FloraClin',
}

export default async function DocumentosSettingsPage() {
  await requireRole('owner', 'practitioner')
  return <DocumentosPageClient />
}
