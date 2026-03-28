import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getProcedure } from '@/db/queries/procedures'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { getProductApplications } from '@/db/queries/product-applications'
import { ProcedureForm } from '@/components/procedures/procedure-form'

interface ProcedurePageProps {
  params: Promise<{
    id: string
    procedureId: string
  }>
}

export default async function ProcedurePage({ params }: ProcedurePageProps) {
  const { id: patientId, procedureId } = await params
  const ctx = await getAuthContext()

  // "novo" means create mode
  if (procedureId === 'novo') {
    return (
      <div className="min-h-screen bg-cream p-6">
        <ProcedureForm patientId={patientId} mode="create" />
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

  // Determine mode: owner and practitioner who created can edit
  const canEdit =
    ctx.role === 'owner' || ctx.userId === procedure.practitionerId
  const mode = canEdit ? 'edit' : 'view'

  return (
    <div className="min-h-screen bg-cream p-6">
      <ProcedureForm
        patientId={patientId}
        procedure={procedure}
        diagrams={diagrams}
        existingApplications={applications}
        mode={mode}
      />
    </div>
  )
}
