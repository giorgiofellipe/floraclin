import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { removeUserMembership } from '@/db/queries/admin-users'

export async function DELETE(
  _request: Request,
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
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('ultima clinica')) return NextResponse.json({ error: msg }, { status: 400 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
