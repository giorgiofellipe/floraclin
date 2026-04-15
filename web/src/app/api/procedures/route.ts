import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { listProcedures, createProcedure } from '@/db/queries/procedures'
import { saveFaceDiagram } from '@/db/queries/face-diagrams'
import { saveProductApplications } from '@/db/queries/product-applications'
import { createProcedureSchema } from '@/validations/procedure'
import { computePlanningStatus } from '@/lib/procedure-status'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const status = computePlanningStatus(body)

    const result = await withTransaction(async (tx) => {
      const procedure = await createProcedure(
        ctx.tenantId,
        ctx.userId,
        parsed.data,
        status,
        tx
      )

      if (body.diagrams && body.diagrams.length > 0) {
        for (const diagram of body.diagrams) {
          await saveFaceDiagram(
            ctx.tenantId,
            procedure.id,
            diagram.viewType,
            diagram.points,
            tx
          )
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

      return procedure
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_record',
      entityId: result.id,
      changes: {
        patientId: { old: null, new: body.patientId },
        procedureTypeId: { old: null, new: body.procedureTypeId },
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
