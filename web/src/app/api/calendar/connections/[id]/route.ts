import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import {
  updateConnection,
  deleteConnection,
  deleteBlocksByConnection,
  clearAppointmentGoogleEventIds,
  getConnectionByUserId,
  listConnections,
} from '@/db/queries/calendar'
import { stopWebhookChannel, revokeToken } from '@/lib/google-calendar'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()
    const { id } = await params

    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (ctx.role === 'practitioner') {
      const own = await getConnectionByUserId(ctx.tenantId, ctx.userId)
      if (!own || own.id !== id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const result = await updateConnection(id, ctx.tenantId, { enabled })
    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { accessToken: _a, refreshToken: _r, syncToken: _s, ...safe } = result
    return NextResponse.json({ success: true, data: safe })
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
    const { id } = await params

    if (!['owner', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const connection = ctx.role === 'practitioner'
      ? await getConnectionByUserId(ctx.tenantId, ctx.userId)
      : (await listConnections(ctx.tenantId)).find(c => c.id === id) ?? null

    if (!connection || connection.id !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (connection.channelId && connection.channelResourceId) {
      await stopWebhookChannel(connection.id, connection.channelId, connection.channelResourceId)
    }

    await deleteBlocksByConnection(connection.id)
    await clearAppointmentGoogleEventIds(ctx.tenantId, connection.userId)

    const deleted = await deleteConnection(id, ctx.tenantId)

    if (deleted) {
      // Both helpers swallow and report their own failures; neither rejects.
      void revokeToken(deleted.accessToken)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
