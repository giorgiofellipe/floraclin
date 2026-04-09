'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { AnamnesisForm } from '@/components/anamnesis/anamnesis-form'
import { SendAnamnesisDialog } from '@/components/patients/send-anamnesis-dialog'
import { useAnamnesis } from '@/hooks/queries/use-anamnesis'
import type { AnamnesisFormData } from '@/validations/anamnesis'

interface PatientAnamnesisTabProps {
  patientId: string
  patientName?: string
  patientPhone?: string | null
}

export function PatientAnamnesisTab({ patientId, patientName, patientPhone }: PatientAnamnesisTabProps) {
  const { data: rawData, isLoading } = useAnamnesis(patientId)

  const initialData = useMemo(() => {
    if (!rawData) return undefined
    return {
      ...rawData,
      id: rawData.id,
      updatedAt: rawData.updatedAt,
      updatedBy: rawData.updatedBy,
      mainComplaint: rawData.mainComplaint ?? '',
      patientGoals: rawData.patientGoals ?? '',
      medicalHistory: (rawData.medicalHistory as AnamnesisFormData['medicalHistory']) ?? {},
      medications: (rawData.medications as AnamnesisFormData['medications']) ?? [],
      allergies: (rawData.allergies as AnamnesisFormData['allergies']) ?? [],
      previousSurgeries: (rawData.previousSurgeries as AnamnesisFormData['previousSurgeries']) ?? [],
      chronicConditions: (rawData.chronicConditions as string[]) ?? [],
      isPregnant: rawData.isPregnant ?? false,
      isBreastfeeding: rawData.isBreastfeeding ?? false,
      lifestyle: (rawData.lifestyle as AnamnesisFormData['lifestyle']) ?? {},
      skinType: (rawData.skinType as AnamnesisFormData['skinType']) ?? undefined,
      skinConditions: (rawData.skinConditions as string[]) ?? [],
      skincareRoutine: (rawData.skincareRoutine as AnamnesisFormData['skincareRoutine']) ?? [],
      previousAestheticTreatments: (rawData.previousAestheticTreatments as AnamnesisFormData['previousAestheticTreatments']) ?? [],
      contraindications: (rawData.contraindications as string[]) ?? [],
      facialEvaluationNotes: rawData.facialEvaluationNotes ?? '',
    } as AnamnesisFormData & { id?: string; updatedAt?: Date | string; updatedBy?: string | null }
  }, [rawData])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando anamnese...</span>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Send anamnesis link to patient */}
      {patientName && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-mid">
            Envie o link para o paciente preencher a anamnese pelo celular.
          </p>
          <SendAnamnesisDialog
            patientId={patientId}
            patientName={patientName}
            patientPhone={patientPhone ?? undefined}
          />
        </div>
      )}

      <AnamnesisForm
        patientId={patientId}
        initialData={initialData}
        updatedByName={undefined}
      />
    </div>
  )
}
