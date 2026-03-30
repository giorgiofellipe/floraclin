import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { getProcedure, updateProcedure } from '@/db/queries/procedures'
import { getFaceDiagram, saveFaceDiagram } from '@/db/queries/face-diagrams'
import { getProductApplications, saveProductApplications } from '@/db/queries/product-applications'
import { updateProcedureSchema } from '@/validations/procedure'

export async function GET(
  _request: Request,
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
      const procedure = await updateProcedure(ctx.tenantId, id, parsed.data, tx)
      if (!procedure) throw new Error('Procedimento não encontrado')

      if (body.diagrams && body.diagrams.length > 0) {
        for (const diagram of body.diagrams) {
          await saveFaceDiagram(ctx.tenantId, id, diagram.viewType, diagram.points, tx)
        }
      }

      if (body.productApplications !== undefined) {
        await saveProductApplications(ctx.tenantId, id, body.productApplications, tx)
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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
