import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getProcedure, updateProcedure } from '@/db/queries/procedures'
import { getFaceDiagram, saveFaceDiagram, type DiagramPointInput } from '@/db/queries/face-diagrams'
import type { DiagramViewType } from '@/types'
import { ensurePlanningGroup, findPlanningGroupId } from '@/db/queries/face-diagram-groups'
import { getProductApplications, saveProductApplications } from '@/db/queries/product-applications'
import { updateProcedureSchema } from '@/validations/procedure'
import { computePlanningStatus } from '@/lib/procedure-status'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const procedure = await getProcedure(ctx.tenantId, id)
    if (!procedure) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
    }

    const [diagrams, applications] = await Promise.all([
      getFaceDiagram(ctx.tenantId, id),
      getProductApplications(ctx.tenantId, id),
    ])

    return NextResponse.json({
      ...procedure,
      diagrams,
      productApplications: applications,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id } = await params
    const body = await request.json()

    const { status: _stripStatus, ...safeBody } = body
    const parsed = updateProcedureSchema.safeParse({ id, ...safeBody })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await withTransaction(async (tx) => {
      // Update scalar fields first (status untouched at this step)
      let procedure = await updateProcedure(ctx.tenantId, id, parsed.data, undefined, tx)
      if (!procedure) throw new Error('Procedimento não encontrado')

      const diagrams: { viewType: DiagramViewType; points: DiagramPointInput[] }[] = body.diagrams ?? []
      const hasPoints = diagrams.some((d) => d.points.length > 0)
      const groupId = hasPoints
        ? await ensurePlanningGroup(tx, {
            tenantId: ctx.tenantId,
            patientId: procedure.patientId,
            practitionerId: procedure.practitionerId,
            procedureRecordId: id,
          })
        : await findPlanningGroupId(tx, ctx.tenantId, id)
      if (groupId) {
        for (const diagram of diagrams) {
          await saveFaceDiagram(ctx.tenantId, groupId, diagram.viewType, diagram.points, tx)
        }
      }

      if (body.productApplications !== undefined) {
        await saveProductApplications(ctx.tenantId, id, body.productApplications, tx)
      }

      // Only draft/planned procedures can transition — approved/executed/cancelled
      // are owned by dedicated lifecycle actions.
      if (procedure.status === 'draft' || procedure.status === 'planned') {
        const freshDiagrams = await getFaceDiagram(ctx.tenantId, id, tx)
        const nextStatus = computePlanningStatus({
          financialPlan: procedure.financialPlan as { totalAmount?: number | string | null } | null,
          diagrams: freshDiagrams,
        })
        if (nextStatus !== procedure.status) {
          const transitioned = await updateProcedure(ctx.tenantId, id, {}, nextStatus, tx)
          if (transitioned) procedure = transitioned
        }
      }

      return procedure
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: id,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return handleApiError(error, request)
  }
}
