import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { removeUserMembership } from '@/db/queries/admin-users'
import { handleApiError } from '@/lib/api-error'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tenantId: string }> }
) {
  try {
    await requirePlatformAdmin()
    const { id, tenantId } = await params

    const membership = await removeUserMembership(id, tenantId)
    if (!membership) {
      return NextResponse.json({ error: 'Vinculo nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: membership })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('ultima clinica')) return NextResponse.json({ error: msg }, { status: 400 })
    return handleApiError(error, request)
  }
}
