'use client'

import { useEffect, useState } from 'react'
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
  // Deep-link from session-picker (Task J1): `?procedure=<recordId>&action=executeNext`
  // mounts the wizard at step 5 and auto-starts the next-session flow for the
  // referenced procedure record.
  const deepLinkProcedureId = searchParams.get('procedure')
  const deepLinkAction = searchParams.get('action')
  const autoStartNext = deepLinkAction === 'executeNext'
  const hasDeepLink = !!deepLinkProcedureId && autoStartNext

  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const { data: tenant, isLoading: tenantLoading } = useTenant()
  const { data: anamnesis, isLoading: anamnesisLoading } = useAnamnesis(patientId)
  const { data: resumedProcedure, isLoading: procedureLoading } = useLatestNonExecutedProcedure(patientId)

  // When the page is opened via the executeNext deep link we need to look up
  // the referenced procedure record to derive its `encounterId` and hydrate
  // the wizard's step 5 with the right context.
  const { data: deepLinkRecord, isLoading: deepLinkLoading } = useProcedure(deepLinkProcedureId ?? '')

  // When `?new=1` is present, start a fresh atendimento regardless of whether
  // there's an ongoing draft/planned procedure for this patient. The existing
  // procedure stays in the DB as a draft the user can resume later from the
  // procedures tab.
  // Deep link wins over the latest-non-executed query so the wizard mounts
  // with the deep-linked record as its primary procedure context.
  const procedure = hasDeepLink
    ? (deepLinkRecord ?? null)
    : forceNew
      ? null
      : resumedProcedure

  // Load full procedure details (with diagrams and applications) if we have one
  const procedureDetailQueryId = hasDeepLink
    ? '' // deep-link branch already used `useProcedure` above; avoid a second fetch
    : (procedure?.id ?? '')
  const { data: procedureDetail, isLoading: detailLoading } = useProcedure(procedureDetailQueryId)

  const isLoading = patientLoading || tenantLoading || anamnesisLoading ||
    (!forceNew && !hasDeepLink && procedureLoading) ||
    (hasDeepLink && deepLinkLoading) ||
    (!!procedure?.id && !hasDeepLink && detailLoading)

  // Once the wizard has mounted with its initial data, we MUST NOT unmount it
  // on later background refetches (e.g. after step 3 creates a procedure and
  // invalidates `useLatestNonExecutedProcedure`). Unmounting wipes wizard
  // state — cart, encounterId, currentStep — and re-initializes from props,
  // which is how users would land back on step 1 after clicking Next at step
  // 3. Track first successful render with state so the gate fires once;
  // a ref would be read during render and trip the react-hooks/refs rule.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    // Intentional one-shot cascade: render once with loading=true, then on
    // the next tick flip hasMounted=true so subsequent loading states no
    // longer gate the wizard. The react-hooks rule warns about this, but
    // the cascade is exactly the desired behavior here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isLoading && !hasMounted) setHasMounted(true)
  }, [isLoading, hasMounted])

  if (isLoading && !hasMounted) {
    return <AtendimentoLoading />
  }

  if (!patient) notFound()
  if (!tenant) notFound()

  // Extract diagrams and applications from full procedure detail. When we are
  // in deep-link mode the deep-link query already returned the full detail; in
  // the regular flow we use the separate `useProcedure(procedure.id)` query.
  const fullDetail = (hasDeepLink ? deepLinkRecord : procedureDetail) as (ProcedureWithDetails & {
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
    execution: procedure?.performedAt && procedure.status === 'completed'
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

  const stepParam = step ? parseInt(step, 10) : undefined
  // Deep-link `?procedure=...&action=executeNext` forces step 5 (execution).
  const initialStep = hasDeepLink
    ? 5
    : stepParam && stepParam >= 1 && stepParam <= 5
      ? stepParam
      : undefined

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
        whatsappApiEnabled: !!(tenant.settings as Record<string, unknown> | null)?.whatsapp_enabled,
      }}
      initialStep={initialStep}
      procedureId={procedure?.id ?? null}
      procedureStatus={(procedure?.status as ProcedureStatus) ?? null}
      procedure={procedure ?? null}
      diagrams={diagrams}
      existingApplications={applications}
      anamnesis={anamnesisData}
      stepTimestamps={stepTimestamps}
      deepLinkProcedureId={hasDeepLink ? deepLinkProcedureId : null}
      autoStartNext={hasDeepLink ? autoStartNext : false}
    />
  )
}
