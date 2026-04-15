import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { diagramSaveSchema } from '@/validations/procedure'
import { saveFaceDiagram, getFaceDiagram, getPreviousDiagramPoints } from '@/db/queries/face-diagrams'
import { verifyTenantOwnership } from '@/db/queries/helpers'
import { procedureRecords } from '@/db/schema'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const procedureRecordId = searchParams.get('procedureRecordId')
    const patientId = searchParams.get('patientId')
    const excludeProcedureId = searchParams.get('excludeProcedureId') ?? undefined

    if (patientId) {
      const points = await getPreviousDiagramPoints(ctx.tenantId, patientId, excludeProcedureId)
      return NextResponse.json(points)
    }

    if (procedureRecordId) {
      const diagrams = await getFaceDiagram(ctx.tenantId, procedureRecordId)
      return NextResponse.json(diagrams)
    }

    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
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
    const parsed = diagramSaveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    await verifyTenantOwnership(ctx.tenantId, procedureRecords, body.procedureRecordId, 'Procedure record')

    const diagramId = await withTransaction(async (tx) => {
      return saveFaceDiagram(
        ctx.tenantId,
        body.procedureRecordId,
        body.viewType,
        body.points,
        tx
      )
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'face_diagram',
      entityId: diagramId,
      changes: {
        procedureRecordId: { old: null, new: body.procedureRecordId },
        viewType: { old: null, new: body.viewType },
        pointCount: { old: null, new: body.points.length },
      },
    })

    return NextResponse.json({ success: true, data: { diagramId } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
