'use client'

import { notFound } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useProcedure } from '@/hooks/queries/use-procedures'
import { useTenant } from '@/hooks/queries/use-tenant'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'

interface ProcedurePageClientProps {
  patientId: string
  procedureId: string
  action?: string
}

export function ProcedurePageClient({ patientId, procedureId, action }: ProcedurePageClientProps) {
  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const isNewProcedure = procedureId === 'novo'
  const { data: procedureData, isLoading: procedureLoading } = useProcedure(
    isNewProcedure ? '' : procedureId
  )
  const { data: tenant, isLoading: tenantLoading } = useTenant()

  const isLoading = patientLoading || (!isNewProcedure && procedureLoading)

  if (isLoading || tenantLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-mid">
        Carregando...
      </div>
    )
  }

  if (!patient) return notFound()

  // "novo" means create mode
  if (isNewProcedure) {
    return (
      <div className="min-h-screen p-6">
        <ProcedureForm patientId={patientId} patientGender={patient.gender} mode="create" />
      </div>
    )
  }

  if (!procedureData || procedureData.patientId !== patientId) {
    return notFound()
  }

  const procedure = procedureData
  const diagrams = procedureData.diagrams ?? []
  const applications = procedureData.productApplications ?? []

  // Approval flow: planned + ?action=approve
  if (procedure.status === 'planned' && action === 'approve') {
    if (!tenant) return notFound()

    const additionalTypeIds = (procedure.additionalTypeIds ?? []) as string[]

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

  // Execution flow: approved + ?action=execute
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

  // View executed procedure (read-only with comparison)
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

  // Cancelled procedure -> read-only view
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

  // Approved procedure (no action) -> read-only summary
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

  // Default: planned procedure form (edit/view)
  // Note: role-based canEdit check is now handled by the API layer
  return (
    <div className="min-h-screen p-6">
      <ProcedureForm
        patientId={patientId}
        patientGender={patient.gender}
        procedure={procedure}
        diagrams={diagrams}
        existingApplications={applications}
        mode="edit"
      />
    </div>
  )
}
