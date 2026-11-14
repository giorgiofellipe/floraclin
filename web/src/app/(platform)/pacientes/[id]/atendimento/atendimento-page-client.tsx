'use client'

import { useEffect, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useAnamnesis, useAnamnesisTemplate } from '@/hooks/queries/use-anamnesis'
import { useLatestNonExecutedProcedure, useProcedure } from '@/hooks/queries/use-procedures'
import { useTenant } from '@/hooks/queries/use-tenant'
import { useAppointment } from '@/hooks/queries/use-appointments'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { ServiceWizard } from '@/components/service-wizard/service-wizard'
import type { ProcedureStatus } from '@/types'
import type { ProcedureWithDetails } from '@/db/queries/procedures'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'
import type { ProductApplicationRecord } from '@/db/queries/product-applications'
import AtendimentoLoading from './loading'

interface AtendimentoPageClientProps {
  patientId: string
}

export function AtendimentoPageClient({ patientId }: AtendimentoPageClientProps) {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')
  const forceNew = searchParams.get('new') === '1'
  // Deep-link from session-picker (Task J1): `?procedure=<recordId>&action=executeNext`
  // mounts the wizard at the execution step and auto-starts the next-session flow for the
  // referenced procedure record.
  const deepLinkProcedureId = searchParams.get('procedure')
  const deepLinkAction = searchParams.get('action')
  const autoStartNext = deepLinkAction === 'executeNext'
  const diagramGroupId = searchParams.get('diagram')
  // Opened from an appointment (Painel): the procedure records which appointment it belongs to.
  const appointmentId = searchParams.get('appointment') ?? undefined
  // Chosen from "Continuar rascunho": carry the patient's unlinked draft into this visit.
  const resumeDraft = searchParams.get('resume') === '1'
  const hasDeepLink = !!deepLinkProcedureId && autoStartNext

  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const { data: tenant, isLoading: tenantLoading } = useTenant()
  const { data: anamnesis, isLoading: anamnesisLoading } = useAnamnesis(patientId)
  const { data: anamnesisTemplate, isLoading: templateLoading } = useAnamnesisTemplate()
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
  // An appointment id from the URL counts only when it belongs to this patient.
  const { data: urlAppointment, isLoading: urlAppointmentLoading } = useAppointment(appointmentId ?? '')
  const visitAppointmentId = urlAppointment?.patientId === patientId ? appointmentId : undefined
  // Opened for an appointment, only that visit's record resumes on its own; an unlinked
  // draft is offered, never mixed in silently.
  const unlinkedDraft = resumedProcedure && !resumedProcedure.appointmentId ? resumedProcedure : null
  let procedure: typeof resumedProcedure | null = resumedProcedure ?? null
  if (hasDeepLink) procedure = deepLinkRecord ?? null
  else if (forceNew) procedure = null
  else if (visitAppointmentId) {
    const isThisVisit = resumedProcedure?.appointmentId === visitAppointmentId
    procedure = isThisVisit || (resumeDraft && unlinkedDraft) ? (resumedProcedure ?? null) : null
  }
  const offeredDraft = visitAppointmentId && !procedure && !hasDeepLink && !forceNew ? unlinkedDraft : null

  // Load full procedure details (with diagrams and applications) if we have one
  const procedureDetailQueryId = hasDeepLink
    ? '' // deep-link branch already used `useProcedure` above; avoid a second fetch
    : (procedure?.id ?? '')
  const { data: procedureDetail, isLoading: detailLoading } = useProcedure(procedureDetailQueryId)

  // The visit's appointment: from the URL, or the one a resumed procedure already belongs to.
  const linkedAppointmentId = visitAppointmentId ?? procedure?.appointmentId ?? ''
  const { data: linkedAppointment, isLoading: appointmentLoading } = useAppointment(linkedAppointmentId)

  const isLoading = patientLoading || tenantLoading || anamnesisLoading || templateLoading ||
    (!!appointmentId && urlAppointmentLoading) ||
    (!!linkedAppointmentId && appointmentLoading) ||
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
  // Choosing "Continuar rascunho" is the one change that must remount it.
  const wizardKey = resumeDraft ? 'resume' : 'visit'
  const [mountedKey, setMountedKey] = useState<string | null>(null)
  useEffect(() => {
    // Intentional one-shot cascade per wizardKey: render once with loading=true,
    // then flip so later loading states no longer gate the wizard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isLoading && mountedKey !== wizardKey) setMountedKey(wizardKey)
  }, [isLoading, mountedKey, wizardKey])

  if (mountedKey !== wizardKey) {
    return <AtendimentoLoading />
  }

  if (!patient) notFound()
  if (!tenant) notFound()
  if (!anamnesisTemplate) throw new Error('Erro ao carregar o modelo de anamnese')

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
    planning: procedure?.updatedAt ? new Date(procedure.updatedAt) : null,
    approval: procedure?.approvedAt ? new Date(procedure.approvedAt) : null,
    execution: procedure?.performedAt && procedure.status === 'completed'
      ? new Date(procedure.performedAt)
      : null,
  }

  const stepParam = step ? parseInt(step, 10) : undefined
  // Deep-link `?procedure=...&action=executeNext` forces the execution step.
  const initialStep = hasDeepLink
    ? 4
    : stepParam && stepParam >= 1 && stepParam <= 4
      ? stepParam
      : undefined

  return (
    <ServiceWizard
      key={wizardKey}
      offeredDraft={
        offeredDraft && visitAppointmentId
          ? {
              createdAt: offeredDraft.createdAt,
              href: `/pacientes/${patientId}/atendimento?appointment=${visitAppointmentId}&resume=1`,
            }
          : null
      }
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
        whatsappApiEnabled: isWhatsAppEnabled(tenant.settings as Record<string, unknown> | null),
      }}
      initialStep={initialStep}
      procedureId={procedure?.id ?? null}
      procedureStatus={(procedure?.status as ProcedureStatus) ?? null}
      procedure={procedure ?? null}
      diagrams={diagrams}
      existingApplications={applications}
      anamnesis={anamnesis ?? null}
      anamnesisTemplate={anamnesisTemplate}
      stepTimestamps={stepTimestamps}
      deepLinkProcedureId={hasDeepLink ? deepLinkProcedureId : null}
      autoStartNext={hasDeepLink ? autoStartNext : false}
      initialDiagramGroupId={diagramGroupId}
      appointment={
        linkedAppointment && linkedAppointment.patientId === patient.id
          ? {
              id: linkedAppointment.id,
              status: linkedAppointment.status,
              date: linkedAppointment.date,
              procedureTypeId: linkedAppointment.procedureTypeId,
            }
          : null
      }
    />
  )
}
