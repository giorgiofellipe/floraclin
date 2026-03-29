import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getPatientAction } from '@/actions/patients'
import { getAuthContext } from '@/lib/auth'
import { getLatestNonExecutedProcedure } from '@/db/queries/procedures'
import { PatientDetailContent } from '@/components/patients/patient-detail-content'

interface PatientDetailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export async function generateMetadata({ params }: PatientDetailPageProps): Promise<Metadata> {
  const { id } = await params
  const patient = await getPatientAction(id)
  return {
    title: patient ? `${patient.fullName} | FloraClin` : 'Paciente | FloraClin',
  }
}

export default async function PatientDetailPage({
  params,
  searchParams,
}: PatientDetailPageProps) {
  const { id } = await params
  const { tab } = await searchParams

  const [patient, auth] = await Promise.all([
    getPatientAction(id),
    getAuthContext(),
  ])

  if (!patient) {
    notFound()
  }

  const activeService = await getLatestNonExecutedProcedure(auth.tenantId, id).catch(() => null)

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <PatientDetailContent patient={patient} activeTab={tab} hasActiveService={!!activeService} />
    </Suspense>
  )
}
