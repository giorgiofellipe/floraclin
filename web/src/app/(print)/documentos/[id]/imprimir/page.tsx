import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getClinicalDocumentWithContext } from '@/db/queries/clinical-documents'
import { PrintDocumentPageClient } from './print-document-page-client'

export const metadata: Metadata = {
  title: 'Imprimir documento | FloraClin',
}

export default async function PrintClinicalDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await getAuthContext()
  const { id } = await params

  const doc = await getClinicalDocumentWithContext(ctx.tenantId, id)
  if (!doc) {
    notFound()
  }

  // Serialize the Date so it crosses the server/client boundary cleanly.
  return <PrintDocumentPageClient doc={{ ...doc, issuedAt: doc.issuedAt }} />
}
