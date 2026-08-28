import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireRole } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getPatient } from '@/db/queries/patients'
import { getPatientEvolutionFeed } from '@/db/queries/patient-evolutions'
import { signLogoPath } from '@/lib/logo'
import { PrintEvolucoesPageClient } from './print-evolucoes-page-client'

interface PrintEvolucoesPageProps {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Imprimir evoluções | FloraClin',
}

export default async function PrintEvolucoesPage({ params }: PrintEvolucoesPageProps) {
  const { id } = await params
  const ctx = await requireRole('owner', 'practitioner')

  const [tenant, patient, entries] = await Promise.all([
    getTenant(ctx.tenantId),
    getPatient(ctx.tenantId, id),
    // RA-2: single source of truth for the evoluções feed. Do NOT re-merge
    // or re-sort here — `getPatientEvolutionFeed` already returns
    // (occurredAt DESC, id DESC) per RA-8.
    getPatientEvolutionFeed(ctx.tenantId, id),
  ])

  if (!tenant || !patient) {
    notFound()
  }

  return (
    <Suspense fallback={null}>
      <PrintEvolucoesPageClient
        tenant={{
          name: tenant.name,
          phone: tenant.phone,
          email: tenant.email,
          logoUrl: await signLogoPath(tenant.logoUrl),
          address: (tenant.address as Record<string, string> | null) ?? null,
        }}
        patient={{
          fullName: patient.fullName,
          cpf: patient.cpf,
          birthDate: patient.birthDate,
          phone: patient.phone,
        }}
        entries={entries}
      />
    </Suspense>
  )
}
