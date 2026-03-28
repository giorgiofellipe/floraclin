import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getPatientAction } from '@/actions/patients'
import { PatientDetailContent } from '@/components/patients/patient-detail-content'

interface PatientDetailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function PatientDetailPage({
  params,
  searchParams,
}: PatientDetailPageProps) {
  const { id } = await params
  const { tab } = await searchParams

  const patient = await getPatientAction(id)

  if (!patient) {
    notFound()
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12 text-mid">
          Carregando...
        </div>
      }
    >
      <PatientDetailContent patient={patient} activeTab={tab} />
    </Suspense>
  )
}
