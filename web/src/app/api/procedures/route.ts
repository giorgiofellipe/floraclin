import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { listProcedures, createProcedure } from '@/db/queries/procedures'
import { saveFaceDiagram } from '@/db/queries/face-diagrams'
import {
  DiagramGroupLockedError,
  DiagramGroupNotFoundError,
  ensurePlanningGroup,
  linkGroupToProcedure,
} from '@/db/queries/face-diagram-groups'
import { saveProductApplications } from '@/db/queries/product-applications'
import { createProcedureSchema } from '@/validations/procedure'
import { computePlanningStatus } from '@/lib/procedure-status'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 })
    }

    const procedures = await listProcedures(ctx.tenantId, patientId)
    return NextResponse.json(procedures)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = createProcedureSchema.safeParse({
      patientId: body.patientId,
      procedureTypeId: body.procedureTypeId,
      additionalTypeIds: body.additionalTypeIds,
      appointmentId: body.appointmentId,
      technique: body.technique,
      clinicalResponse: body.clinicalResponse,
      adverseEffects: body.adverseEffects,
      notes: body.notes,
      followUpDate: body.followUpDate,
      nextSessionObjectives: body.nextSessionObjectives,
      financialPlan: body.financialPlan,
      diagramGroupId: body.diagramGroupId,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const status = computePlanningStatus(body)

    const { patientId, diagramGroupId, ...createData } = parsed.data

    const result = await withTransaction(async (tx) => {
      const procedure = await createProcedure(
        ctx.tenantId,
        patientId,
        ctx.userId,
        { ...createData, status },
        tx
      )

      if (diagramGroupId) {
        await linkGroupToProcedure(tx, {
          tenantId: ctx.tenantId,
          patientId,
          groupId: diagramGroupId,
          procedureRecordId: procedure.id,
        })
      }

      let groupId = diagramGroupId ?? null
      const hasPoints = body.diagrams?.some((d: { points: unknown[] }) => d.points.length > 0) ?? false
      if (body.diagrams && (groupId || hasPoints)) {
        groupId ??= await ensurePlanningGroup(tx, {
          tenantId: ctx.tenantId,
          patientId,
          practitionerId: procedure.practitionerId,
          procedureRecordId: procedure.id,
        })
        for (const diagram of body.diagrams) {
          await saveFaceDiagram(ctx.tenantId, groupId, diagram.viewType, diagram.points, tx)
        }
      }

      if (body.productApplications && body.productApplications.length > 0) {
        await saveProductApplications(
          ctx.tenantId,
          procedure.id,
          body.productApplications,
          tx
        )
      }

      return { procedure, groupId }
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_record',
      entityId: result.procedure.id,
      changes: {
        patientId: { old: null, new: body.patientId },
        procedureTypeId: { old: null, new: body.procedureTypeId },
        diagramGroupId: { old: null, new: result.groupId },
      },
    })

    return NextResponse.json({ success: true, data: result.procedure })
  } catch (error) {
    if (error instanceof DiagramGroupNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof DiagramGroupLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
