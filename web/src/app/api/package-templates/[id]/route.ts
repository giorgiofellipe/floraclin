import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  getPackageTemplate,
  updatePackageTemplate,
  deletePackageTemplate,
} from '@/db/queries/packages'
import { updatePackageTemplateSchema } from '@/validations/package'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = updatePackageTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const existing = await getPackageTemplate(ctx.tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Modelo de pacote não encontrado' }, { status: 404 })
    }

    const updated = await updatePackageTemplate(ctx.tenantId, id, {
      name: parsed.data.name,
      description: parsed.data.description ?? undefined,
      defaultPrice: parsed.data.defaultPrice ?? undefined,
      validityMonths: parsed.data.validityMonths ?? undefined,
      isActive: parsed.data.isActive,
      lines: parsed.data.lines,
    })

    if (!updated) {
      return NextResponse.json({ error: 'Falha ao atualizar modelo' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'package_template',
      entityId: id,
      changes: { template: { old: existing, new: parsed.data } },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const ok = await deletePackageTemplate(ctx.tenantId, id)
    if (!ok) {
      return NextResponse.json({ error: 'Modelo de pacote não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'package_template',
      entityId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
