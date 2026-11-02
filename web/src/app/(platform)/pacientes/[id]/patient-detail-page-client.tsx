'use client'

import { notFound } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useProcedures } from '@/hooks/queries/use-procedures'
import { PatientDetailContent } from '@/components/patients/patient-detail-content'
import PatientDetailLoading from './loading'
import { isOpenStatus } from '@/lib/procedure-status'
import type { ProcedureStatus, Role } from '@/types'

interface PatientDetailPageClientProps {
  patientId: string
  whatsappApiEnabled?: boolean
  role: Role
}

export function PatientDetailPageClient({ patientId, whatsappApiEnabled = false, role }: PatientDetailPageClientProps) {
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

  const hasActiveService =
    proceduresResult?.some((p: { status: ProcedureStatus }) => isOpenStatus(p.status)) ?? false

  return (
    <PatientDetailContent
      patient={patient}
      activeTab={tab}
      hasActiveService={hasActiveService}
      whatsappApiEnabled={whatsappApiEnabled}
      role={role}
    />
  )
}
