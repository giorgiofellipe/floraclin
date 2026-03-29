import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getProcedure } from '@/db/queries/procedures'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { getProductApplications } from '@/db/queries/product-applications'
import { getPatient } from '@/db/queries/patients'
import { getTenant } from '@/db/queries/tenants'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'
import { db } from '@/db/client'
import { procedureRecords } from '@/db/schema'
import { eq } from 'drizzle-orm'

interface ProcedurePageProps {
  params: Promise<{
    id: string
    procedureId: string
  }>
  searchParams: Promise<{
    action?: string
  }>
}

export default async function ProcedurePage({ params, searchParams }: ProcedurePageProps) {
  const { id: patientId, procedureId } = await params
  const { action } = await searchParams
  const ctx = await getAuthContext()

  // Fetch patient to get gender
  const patient = await getPatient(ctx.tenantId, patientId)
  if (!patient) notFound()

  // "novo" means create mode
  if (procedureId === 'novo') {
    return (
      <div className="min-h-screen p-6">
        <ProcedureForm patientId={patientId} patientGender={patient.gender} mode="create" />
      </div>
    )
  }

  // Load existing procedure
  const procedure = await getProcedure(ctx.tenantId, procedureId)

  if (!procedure || procedure.patientId !== patientId) {
    notFound()
  }

  // Load related data
  const [diagrams, applications] = await Promise.all([
    getFaceDiagram(ctx.tenantId, procedureId),
    getProductApplications(ctx.tenantId, procedureId),
  ])

  // ─── Approval flow: planned + ?action=approve ─────────────────────
  if (procedure.status === 'planned' && action === 'approve') {
    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) notFound()

    // Get additionalTypeIds from raw record
    const [rawRecord] = await db
      .select({ additionalTypeIds: procedureRecords.additionalTypeIds })
      .from(procedureRecords)
      .where(eq(procedureRecords.id, procedureId))
      .limit(1)

    const additionalTypeIds = (rawRecord?.additionalTypeIds as string[] | null) ?? []

    return (
      <div className="min-h-screen p-6">
        <ProcedureApproval
          procedure={procedure}
          diagrams={diagrams}
          patient={{
            id: patient.id,
            fullName: patient.fullName,
            cpf: patient.cpf,
            gender: patient.gender,
          }}
          tenant={{
            id: tenant.id,
            name: tenant.name,
          }}
          additionalTypeIds={additionalTypeIds}
        />
      </div>
    )
  }

  // ─── Execution flow: approved + ?action=execute ───────────────────
  if (procedure.status === 'approved' && action === 'execute') {
    return (
      <div className="min-h-screen p-6">
        <ProcedureExecution
          patientId={patientId}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          existingApplications={applications}
        />
      </div>
    )
  }

  // ─── View executed procedure (read-only with comparison) ──────────
  if (procedure.status === 'executed') {
    return (
      <div className="min-h-screen p-6">
        <ProcedureExecution
          patientId={patientId}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          existingApplications={applications}
        />
      </div>
    )
  }

  // ─── Cancelled procedure → read-only view ────────────────────────
  if (procedure.status === 'cancelled') {
    return (
      <div className="min-h-screen p-6">
        <ProcedureForm
          patientId={patientId}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          existingApplications={applications}
          mode="view"
        />
      </div>
    )
  }

  // ─── Approved procedure (no action) → read-only summary ──────────
  if (procedure.status === 'approved') {
    return (
      <div className="min-h-screen p-6">
        <ProcedureForm
          patientId={patientId}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          existingApplications={applications}
          mode="view"
        />
      </div>
    )
  }

  // ─── Default: planned procedure form (edit/view) ─────────────────
  const canEdit =
    ctx.role === 'owner' || ctx.userId === procedure.practitionerId
  const mode = canEdit ? 'edit' : 'view'

  return (
    <div className="min-h-screen p-6">
      <ProcedureForm
        patientId={patientId}
        patientGender={patient.gender}
        procedure={procedure}
        diagrams={diagrams}
        existingApplications={applications}
        mode={mode}
      />
    </div>
  )
}
