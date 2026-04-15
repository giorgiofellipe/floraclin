import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { productApplicationSchema } from '@/validations/procedure'
import { saveProductApplications, getProductApplications } from '@/db/queries/product-applications'
import { verifyTenantOwnership } from '@/db/queries/helpers'
import { procedureRecords } from '@/db/schema'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const procedureRecordId = searchParams.get('procedureRecordId')

    if (!procedureRecordId) {
      return NextResponse.json({ error: 'Missing procedureRecordId' }, { status: 400 })
    }

    const applications = await getProductApplications(ctx.tenantId, procedureRecordId)
    return NextResponse.json(applications)
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
    const parsed = productApplicationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    await verifyTenantOwnership(ctx.tenantId, procedureRecords, body.procedureRecordId, 'Procedure record')

    const result = await withTransaction(async (tx) => {
      return saveProductApplications(
        ctx.tenantId,
        body.procedureRecordId,
        body.applications,
        tx
      )
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'product_application',
      entityId: body.procedureRecordId,
      changes: { applicationCount: { old: null, new: body.applications.length } },
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
