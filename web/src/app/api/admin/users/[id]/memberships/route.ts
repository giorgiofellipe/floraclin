import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { addUserMembership } from '@/db/queries/admin-users'
import { addMembershipSchema } from '@/validations/admin'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json()
    const parsed = addMembershipSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados invalidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const membership = await addUserMembership(id, parsed.data.tenantId, parsed.data.role)
    return NextResponse.json({ success: true, data: membership })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
