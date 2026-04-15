'use client'

import { PatientForm } from './patient-form'
import type { Patient } from '@/db/queries/patients'

interface PatientDataTabProps {
  patient: Patient
}

export function PatientDataTab({ patient }: PatientDataTabProps) {
  return (
    <div className="max-w-2xl space-y-4">
      <PatientForm
        open={true}
        onOpenChange={() => {}}
        patient={patient}
        inline
      />
    </div>
  )
}
