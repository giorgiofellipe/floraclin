'use client'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Printer, Package as PackageIcon } from 'lucide-react'
import { usePatient } from '@/hooks/queries/use-patients'
import { useProcedure } from '@/hooks/queries/use-procedures'
import { useTenant } from '@/hooks/queries/use-tenant'
import { usePatientPackages } from '@/hooks/queries/use-packages'
import { ProcedureForm } from '@/components/procedures/procedure-form'
import { ProcedureExecution } from '@/components/procedures/procedure-execution'
import { ProcedureApproval } from '@/components/procedures/procedure-approval'
import { ProcedureDetailView } from '@/components/procedures/procedure-detail-view'
import { Button } from '@/components/ui/button'

function SessionProgressBanner({
  patientId,
  procedure,
}: {
  patientId: string
  procedure: {
    patientPackageId?: string | null
    sessionsTotal?: number
    sessionsExecuted?: number
  }
}) {
  const patientPackageId = procedure.patientPackageId ?? null
  const { data: packages } = usePatientPackages(patientPackageId ? patientId : '')
  const sessionsTotal = procedure.sessionsTotal ?? 1
  const sessionsExecuted = procedure.sessionsExecuted ?? 0

  const pkg = patientPackageId
    ? (packages ?? []).find((p) => p.id === patientPackageId)
    : null

  if (!pkg && sessionsTotal <= 1) return null

  return (
    <div className="mx-auto mb-4 flex max-w-4xl items-center gap-2 rounded-md border border-sage/20 bg-sage/5 px-3 py-1.5 text-[12px] text-sage">
      <PackageIcon className="size-3.5" />
      <span>
        {pkg && <><span className="font-medium">{pkg.name}</span> · </>}
        sessões:{' '}
        <span className="tabular-nums">
          {sessionsExecuted}/{sessionsTotal}
        </span>
      </span>
    </div>
  )
}

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
        <ProcedureForm
          patientId={patientId}
          patientName={patient.fullName}
          patientGender={patient.gender}
          mode="create"
        />
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
            phone: patient.phone,
          }}
          tenant={{
            id: tenant.id,
            name: tenant.name,
            whatsappApiEnabled: !!(tenant.settings as Record<string, unknown> | null)?.whatsapp_enabled,
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
          encounterId={procedure.encounterId ?? procedure.id}
          procedureRecordIds={[procedure.id]}
          packageId={procedure.patientPackageId ?? null}
          patientId={patientId}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          existingApplications={applications}
          deepLinkProcedureId={procedure.id}
          autoStartNext
        />
      </div>
    )
  }

  // Read-only detail view for executed or cancelled procedures
  if (procedure.status === 'completed' || procedure.status === 'cancelled') {
    return (
      <div className="min-h-screen p-6">
        <SessionProgressBanner patientId={patientId} procedure={procedure} />
        {procedure.status === 'completed' && (
          <div className="mx-auto mb-3 flex max-w-3xl items-center justify-end">
            <Link href={`/procedimentos/${procedure.id}/imprimir`}>
              <Button variant="outline" size="sm">
                <Printer className="size-3.5 mr-1.5" />
                Imprimir
              </Button>
            </Link>
          </div>
        )}
        <ProcedureDetailView
          patientId={patientId}
          patientName={patient.fullName}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          applications={applications}
        />
      </div>
    )
  }

  // Approved procedure (no action) -> read-only detail view
  if (procedure.status === 'approved') {
    return (
      <div className="min-h-screen p-6">
        <SessionProgressBanner patientId={patientId} procedure={procedure} />
        <ProcedureDetailView
          patientId={patientId}
          patientName={patient.fullName}
          patientGender={patient.gender}
          procedure={procedure}
          diagrams={diagrams}
          applications={applications}
        />
      </div>
    )
  }

  // Default: planned procedure form (edit)
  return (
    <div className="min-h-screen p-6">
      <SessionProgressBanner patientId={patientId} procedure={procedure} />
      <ProcedureForm
        patientId={patientId}
        patientName={patient.fullName}
        patientGender={patient.gender}
        procedure={procedure}
        diagrams={diagrams}
        existingApplications={applications}
        mode="edit"
      />
    </div>
  )
}
