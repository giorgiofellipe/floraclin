import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { updateConnection, getConnectionByUserId, listConnections } from '@/db/queries/calendar'
import { disconnectCalendar } from '@/lib/google-calendar'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { id } = await params

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
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { id } = await params

    const connection = ctx.role === 'practitioner'
      ? await getConnectionByUserId(ctx.tenantId, ctx.userId)
      : (await listConnections(ctx.tenantId)).find(c => c.id === id) ?? null

    if (!connection || connection.id !== id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await disconnectCalendar(connection)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
