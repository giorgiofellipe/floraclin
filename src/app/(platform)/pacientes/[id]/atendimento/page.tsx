import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { getLatestNonExecutedProcedure } from '@/db/queries/procedures'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { getProductApplications } from '@/db/queries/product-applications'
import { ServiceWizard } from '@/components/service-wizard/service-wizard'
import type { ProcedureStatus } from '@/types'

interface AtendimentoPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ step?: string }>
}

export async function generateMetadata({ params }: AtendimentoPageProps): Promise<Metadata> {
  const { id } = await params
  const ctx = await getAuthContext()
  const patient = await getPatient(ctx.tenantId, id)
  return {
    title: patient
      ? `Atendimento \u00b7 ${patient.fullName} | FloraClin`
      : 'Atendimento | FloraClin',
  }
}

export default async function AtendimentoPage({
  params,
  searchParams,
}: AtendimentoPageProps) {
  const { id: patientId } = await params
  const { step } = await searchParams
  const ctx = await getAuthContext()

  // ─── Load patient ──────────────────────────────────────────────
  const patient = await getPatient(ctx.tenantId, patientId)
  if (!patient) notFound()

  // ─── Load anamnesis + latest non-executed procedure ────────────
  const [anamnesis, procedure] = await Promise.all([
    getAnamnesis(ctx.tenantId, patientId),
    getLatestNonExecutedProcedure(ctx.tenantId, patientId),
  ])

  // ─── If procedure exists, load diagrams + product applications ─
  let diagrams = null
  let applications = null
  if (procedure) {
    ;[diagrams, applications] = await Promise.all([
      getFaceDiagram(ctx.tenantId, procedure.id),
      getProductApplications(ctx.tenantId, procedure.id),
    ])
  }

  // ─── Build step timestamps ─────────────────────────────────────
  const stepTimestamps = {
    anamnesis: anamnesis?.updatedAt ? new Date(anamnesis.updatedAt) : null,
    planning: procedure?.updatedAt ? new Date(procedure.updatedAt) : null,
    approval: procedure?.approvedAt ? new Date(procedure.approvedAt) : null,
    execution: procedure?.performedAt && procedure.status === 'executed'
      ? new Date(procedure.performedAt)
      : null,
  }

  // ─── Parse step from URL ───────────────────────────────────────
  const initialStep = step ? parseInt(step, 10) : undefined

  return (
    <ServiceWizard
      patient={{
        id: patient.id,
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        phone: patient.phone,
        cpf: patient.cpf,
      }}
      initialStep={initialStep && initialStep >= 1 && initialStep <= 4 ? initialStep : undefined}
      procedureId={procedure?.id ?? null}
      procedureStatus={(procedure?.status as ProcedureStatus) ?? null}
      stepTimestamps={stepTimestamps}
    />
  )
}
