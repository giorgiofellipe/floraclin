import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getProcedureType, updateProcedureType, deleteProcedureType } from '@/db/queries/tenants'
import { updateProcedureTypeSchema } from '@/validations/tenant'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updateProcedureTypeSchema.safeParse({ id, ...body })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { id: ptId, ...updateData } = parsed.data
    const existing = await getProcedureType(ctx.tenantId, ptId)
    if (!existing) {
      return NextResponse.json({ error: 'Tipo de procedimento não encontrado' }, { status: 404 })
    }

    const pt = await updateProcedureType(ctx.tenantId, ptId, updateData)
    if (!pt) {
      return NextResponse.json({ error: 'Erro ao atualizar tipo de procedimento' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'procedure_type',
      entityId: ptId,
      changes: { procedureType: { old: existing, new: updateData } },
    })

    return NextResponse.json({ success: true, data: pt })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const pt = await deleteProcedureType(ctx.tenantId, id)
    if (!pt) {
      return NextResponse.json({ error: 'Tipo de procedimento não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'procedure_type',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
