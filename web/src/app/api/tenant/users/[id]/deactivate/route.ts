import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { deactivateUser } from '@/db/queries/users'
import { getConnectionByUserId } from '@/db/queries/calendar'
import { disconnectCalendar } from '@/lib/google-calendar'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const { id: userId } = await params

    if (userId === ctx.userId) {
      return NextResponse.json({ error: 'Você não pode desativar sua própria conta' }, { status: 400 })
    }

    const result = await deactivateUser(ctx.tenantId, userId)
    if (!result) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // The iCal feed and the Google push are keyed to the connection, not the
    // membership, so they keep serving this member's appointments until it goes.
    const connection = await getConnectionByUserId(ctx.tenantId, userId)
    if (connection) await disconnectCalendar(connection)

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant_user',
      entityId: userId,
      changes: { isActive: { old: true, new: false } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
