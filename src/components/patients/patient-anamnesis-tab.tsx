'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { getAnamnesisAction } from '@/actions/anamnesis'
import type { AnamnesisFormData } from '@/validations/anamnesis'

interface PatientAnamnesisTabProps {
  patientId: string
}

export function PatientAnamnesisTab({ patientId }: PatientAnamnesisTabProps) {
  const [loading, setLoading] = useState(true)
  const [initialData, setInitialData] = useState<
    (AnamnesisFormData & { id?: string; updatedAt?: Date | string; updatedBy?: string | null }) | undefined
  >(undefined)
  const [updatedByName, setUpdatedByName] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await getAnamnesisAction(patientId)
        if (!cancelled && data) {
          setInitialData({
            ...data,
            id: data.id,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
            mainComplaint: data.mainComplaint ?? '',
            patientGoals: data.patientGoals ?? '',
            medicalHistory: (data.medicalHistory as AnamnesisFormData['medicalHistory']) ?? {},
            medications: (data.medications as AnamnesisFormData['medications']) ?? [],
            allergies: (data.allergies as AnamnesisFormData['allergies']) ?? [],
            previousSurgeries: (data.previousSurgeries as AnamnesisFormData['previousSurgeries']) ?? [],
            chronicConditions: (data.chronicConditions as string[]) ?? [],
            isPregnant: data.isPregnant ?? false,
            isBreastfeeding: data.isBreastfeeding ?? false,
            lifestyle: (data.lifestyle as AnamnesisFormData['lifestyle']) ?? {},
            skinType: (data.skinType as AnamnesisFormData['skinType']) ?? undefined,
            skinConditions: (data.skinConditions as string[]) ?? [],
            skincareRoutine: (data.skincareRoutine as AnamnesisFormData['skincareRoutine']) ?? [],
            previousAestheticTreatments: (data.previousAestheticTreatments as AnamnesisFormData['previousAestheticTreatments']) ?? [],
            contraindications: (data.contraindications as string[]) ?? [],
            facialEvaluationNotes: data.facialEvaluationNotes ?? '',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [patientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando anamnese...</span>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <AnamnesisForm
        patientId={patientId}
        initialData={initialData}
        updatedByName={updatedByName}
      />
    </div>
  )
}
