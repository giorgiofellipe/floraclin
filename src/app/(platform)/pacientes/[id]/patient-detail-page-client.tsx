'use client'

import { notFound } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useProcedures } from '@/hooks/queries/use-procedures'
import { PatientDetailContent } from '@/components/patients/patient-detail-content'
import PatientDetailLoading from './loading'

interface PatientDetailPageClientProps {
  patientId: string
}

export function PatientDetailPageClient({ patientId }: PatientDetailPageClientProps) {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') ?? undefined

  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const { data: proceduresResult } = useProcedures(patientId)

  if (patientLoading) {
    return <PatientDetailLoading />
  }

  if (!patient) {
    notFound()
  }

  // Check if there's an active (non-executed) procedure
  const hasActiveService = proceduresResult?.some(
    (p: { status: string }) => p.status === 'planned' || p.status === 'approved'
  ) ?? false

  return (
    <PatientDetailContent
      patient={patient}
      activeTab={tab}
      hasActiveService={hasActiveService}
    />
  )
}
