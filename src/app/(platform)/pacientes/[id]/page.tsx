import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getPatientAction } from '@/actions/patients'
import { PatientDetailPageClient } from './patient-detail-page-client'

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
}: PatientDetailPageProps) {
  const { id } = await params

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <PatientDetailPageClient patientId={id} />
    </Suspense>
  )
}
