'use client'

import { FinancialList } from '@/components/financial/financial-list'

interface PatientFinancialTabProps {
  patientId: string
  patientName: string
}

export function PatientFinancialTab({ patientId, patientName }: PatientFinancialTabProps) {
  const patients = [{ id: patientId, fullName: patientName }]

  return <FinancialList patients={patients} defaultPatientId={patientId} />
}
