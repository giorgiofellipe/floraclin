import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { getProcedure } from '@/db/queries/procedures'
import { getPatient } from '@/db/queries/patients'
import { getProductApplications } from '@/db/queries/product-applications'
import { getSignatureBlock } from '@/lib/professional'
import { PrintProcedurePageClient } from './print-procedure-page-client'

interface PrintProcedurePageProps {
  params: Promise<{ id: string }>
}

export const metadata: Metadata = {
  title: 'Imprimir procedimento | FloraClin',
}

export default async function PrintProcedurePage({ params }: PrintProcedurePageProps) {
  const { id } = await params
  const auth = await getAuthContext()

  const procedure = await getProcedure(auth.tenantId, id)
  if (!procedure || procedure.status !== 'completed' || !procedure.performedAt) {
    notFound()
  }

  const [tenant, patient, applications, signature] = await Promise.all([
    getTenant(auth.tenantId),
    getPatient(auth.tenantId, procedure.patientId),
    getProductApplications(auth.tenantId, procedure.id),
    getSignatureBlock(procedure.practitionerId),
  ])

  if (!tenant || !patient) {
    notFound()
  }

  return (
    <PrintProcedurePageClient
      tenant={{
        name: tenant.name,
        phone: tenant.phone,
        email: tenant.email,
        logoUrl: tenant.logoUrl,
        address: (tenant.address as Record<string, string> | null) ?? null,
      }}
      procedure={{
        id: procedure.id,
        procedureTypeName: procedure.procedureTypeName,
        procedureTypeCategory: procedure.procedureTypeCategory,
        performedAt: procedure.performedAt,
        technique: procedure.technique,
        clinicalResponse: procedure.clinicalResponse,
        adverseEffects: procedure.adverseEffects,
        notes: procedure.notes,
        followUpDate: procedure.followUpDate,
        nextSessionObjectives: procedure.nextSessionObjectives,
        practitionerName: procedure.practitionerName,
      }}
      patient={{
        fullName: patient.fullName,
        cpf: patient.cpf,
        birthDate: patient.birthDate,
        phone: patient.phone,
      }}
      applications={applications}
      signature={signature}
    />
  )
}
