import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { deleteBlockById } from '@/db/queries/calendar'
import { handleApiError } from '@/lib/api-error'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked
    const { id } = await params

    const deleted = await deleteBlockById(ctx.tenantId, id)
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
