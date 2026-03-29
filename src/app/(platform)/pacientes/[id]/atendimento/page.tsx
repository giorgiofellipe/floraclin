import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getPatient } from '@/db/queries/patients'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { getLatestNonExecutedProcedure } from '@/db/queries/procedures'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { getProductApplications } from '@/db/queries/product-applications'
import { getTenant } from '@/db/queries/tenants'
import { ServiceWizard } from '@/components/service-wizard/service-wizard'
import type { ProcedureStatus } from '@/types'
import type { AnamnesisFormData } from '@/validations/anamnesis'

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

  // ─── Load patient + tenant ──────────────────────────────────────
  const [patient, tenant] = await Promise.all([
    getPatient(ctx.tenantId, patientId),
    getTenant(ctx.tenantId),
  ])
  if (!patient) notFound()
  if (!tenant) notFound()

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
    procedureTypes: procedure?.procedureTypeId ? (procedure?.createdAt ? new Date(procedure.createdAt) : new Date()) : null,
    planning: procedure?.updatedAt ? new Date(procedure.updatedAt) : null,
    approval: procedure?.approvedAt ? new Date(procedure.approvedAt) : null,
    execution: procedure?.performedAt && procedure.status === 'executed'
      ? new Date(procedure.performedAt)
      : null,
  }

  // ─── Transform anamnesis for AnamnesisForm ─────────────────────
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
