import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { listProcedureTypes, createProcedureType } from '@/db/queries/tenants'
import { procedureTypeSchema } from '@/validations/tenant'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const types = await listProcedureTypes(ctx.tenantId)
    return NextResponse.json(types)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = procedureTypeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const pt = await createProcedureType(ctx.tenantId, parsed.data)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'procedure_type',
      entityId: pt.id,
      changes: { procedureType: { old: null, new: parsed.data } },
    })

    return NextResponse.json({ success: true, data: pt })
  } catch (error) {
    return handleApiError(error, request)
  }
}
