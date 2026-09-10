import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { updateUserRole } from '@/db/queries/users'
import { updateUserRoleSchema } from '@/validations/user'
import type { Role } from '@/types'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id: userId } = await params
    const body = await request.json()
    const parsed = updateUserRoleSchema.safeParse({ userId, role: body.role })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const updated = await updateUserRole(ctx.tenantId, parsed.data.userId, parsed.data.role as Role)
    if (!updated) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant_user',
      entityId: userId,
      changes: { role: { old: null, new: body.role } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
