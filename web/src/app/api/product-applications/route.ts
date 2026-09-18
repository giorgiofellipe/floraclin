import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { withTransaction } from '@/lib/tenant'
import { productApplicationSchema } from '@/validations/procedure'
import { saveProductApplications, getProductApplications } from '@/db/queries/product-applications'
import { verifyTenantOwnership } from '@/db/queries/helpers'
import { procedureRecords } from '@/db/schema'
import { handleApiError } from '@/lib/api-error'

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
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

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
    return handleApiError(error, request)
  }
}
