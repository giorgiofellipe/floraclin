'use client'

import { notFound, useSearchParams } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useAnamnesis } from '@/hooks/queries/use-anamnesis'
import { useLatestNonExecutedProcedure, useProcedure } from '@/hooks/queries/use-procedures'
import { useTenant } from '@/hooks/queries/use-tenant'
import { ServiceWizard } from '@/components/service-wizard/service-wizard'
import type { ProcedureStatus } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import type { AnamnesisFormData } from '@/validations/anamnesis'
import AtendimentoLoading from './loading'

interface AtendimentoPageClientProps {
  patientId: string
}

export function AtendimentoPageClient({ patientId }: AtendimentoPageClientProps) {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')
  const forceNew = searchParams.get('new') === '1'

  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const { data: tenant, isLoading: tenantLoading } = useTenant()
  const { data: anamnesis, isLoading: anamnesisLoading } = useAnamnesis(patientId)
  const { data: resumedProcedure, isLoading: procedureLoading } = useLatestNonExecutedProcedure(patientId)

  // When `?new=1` is present, start a fresh atendimento regardless of whether
  // there's an ongoing draft/planned procedure for this patient. The existing
  // procedure stays in the DB as a draft the user can resume later from the
  // procedures tab.
  const procedure = forceNew ? null : resumedProcedure

  // Load full procedure details (with diagrams and applications) if we have one
  const { data: procedureDetail, isLoading: detailLoading } = useProcedure(procedure?.id ?? '')

  const isLoading = patientLoading || tenantLoading || anamnesisLoading ||
    (!forceNew && procedureLoading) ||
    (!!procedure?.id && detailLoading)

  if (isLoading) {
    return <AtendimentoLoading />
  }

  if (!patient) notFound()
  if (!tenant) notFound()

  // Extract diagrams and applications from full procedure detail
  const fullDetail = procedureDetail as (ProcedureWithDetails & {
    diagrams?: DiagramWithPoints[]
    productApplications?: ProductApplicationRecord[]
  }) | undefined
  const diagrams = fullDetail?.diagrams ?? null
  const applications = fullDetail?.productApplications ?? null

  // Build step timestamps
  const stepTimestamps = {
    anamnesis: anamnesis?.updatedAt ? new Date(anamnesis.updatedAt) : null,
    procedureTypes: procedure?.procedureTypeId
      ? (procedure?.createdAt ? new Date(procedure.createdAt) : new Date())
      : null,
    planning: procedure?.updatedAt ? new Date(procedure.updatedAt) : null,
    approval: procedure?.approvedAt ? new Date(procedure.approvedAt) : null,
    execution: procedure?.performedAt && procedure.status === 'executed'
      ? new Date(procedure.performedAt)
      : null,
  }

  // Transform anamnesis for AnamnesisForm
  const anamnesisData = anamnesis
    ? {
        id: anamnesis.id,
        updatedAt: anamnesis.updatedAt,
        updatedBy: anamnesis.updatedBy,
        mainComplaint: anamnesis.mainComplaint ?? '',
        patientGoals: anamnesis.patientGoals ?? '',
        medicalHistory: (anamnesis.medicalHistory as AnamnesisFormData['medicalHistory']) ?? {},
        medications: (anamnesis.medications as AnamnesisFormData['medications']) ?? [],
        allergies: (anamnesis.allergies as AnamnesisFormData['allergies']) ?? [],
        previousSurgeries: (anamnesis.previousSurgeries as AnamnesisFormData['previousSurgeries']) ?? [],
        chronicConditions: (anamnesis.chronicConditions as string[]) ?? [],
        isPregnant: anamnesis.isPregnant ?? false,
        isBreastfeeding: anamnesis.isBreastfeeding ?? false,
        lifestyle: (anamnesis.lifestyle as AnamnesisFormData['lifestyle']) ?? {},
        skinType: (anamnesis.skinType as AnamnesisFormData['skinType']) ?? undefined,
        skinConditions: (anamnesis.skinConditions as string[]) ?? [],
        skincareRoutine: (anamnesis.skincareRoutine as AnamnesisFormData['skincareRoutine']) ?? [],
        previousAestheticTreatments: (anamnesis.previousAestheticTreatments as AnamnesisFormData['previousAestheticTreatments']) ?? [],
        contraindications: (anamnesis.contraindications as string[]) ?? [],
        facialEvaluationNotes: anamnesis.facialEvaluationNotes ?? '',
      }
    : null

  const initialStep = step ? parseInt(step, 10) : undefined

  return (
    <ServiceWizard
      patient={{
        id: patient.id,
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        phone: patient.phone,
        cpf: patient.cpf,
        gender: patient.gender,
      }}
      tenant={{
        id: tenant.id,
        name: tenant.name,
      }}
      initialStep={initialStep && initialStep >= 1 && initialStep <= 5 ? initialStep : undefined}
      procedureId={procedure?.id ?? null}
      procedureStatus={(procedure?.status as ProcedureStatus) ?? null}
      procedure={procedure ?? null}
      diagrams={diagrams}
      existingApplications={applications}
      anamnesis={anamnesisData}
      stepTimestamps={stepTimestamps}
    />
  )
}
