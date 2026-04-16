import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getProcedure, executeProcedure } from '@/db/queries/procedures'
import { saveFaceDiagram } from '@/db/queries/face-diagrams'
import { saveProductApplications } from '@/db/queries/product-applications'
import { procedureExecutionWireSchema } from '@/validations/procedure'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: procedureId } = await params
    const rawBody = await request.json()

    const parsed = procedureExecutionWireSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const procedure = await getProcedure(ctx.tenantId, procedureId)
    if (!procedure) {
      return NextResponse.json({ error: 'Procedimento não encontrado' }, { status: 404 })
    }

    if (procedure.status !== 'approved') {
      return NextResponse.json({ error: 'Apenas procedimentos aprovados podem ser executados' }, { status: 400 })
    }

    const result = await withTransaction(async (tx) => {
      const updated = await executeProcedure(
        ctx.tenantId,
        procedureId,
        {
          technique: body.technique,
          clinicalResponse: body.clinicalResponse,
          adverseEffects: body.adverseEffects,
          notes: body.notes,
          followUpDate: body.followUpDate,
          nextSessionObjectives: body.nextSessionObjectives,
        },
        tx
      )
      if (!updated) throw new Error('Falha ao executar procedimento')

      if (body.diagrams && body.diagrams.length > 0) {
        for (const diagram of body.diagrams) {
          await saveFaceDiagram(ctx.tenantId, procedureId, diagram.viewType, diagram.points, tx)
        }
      }

      if (body.productApplications !== undefined) {
        await saveProductApplications(ctx.tenantId, procedureId, body.productApplications, tx)
      }

      return updated
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_record',
      entityId: procedureId,
      changes: { status: { old: 'approved', new: 'executed' } },
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
