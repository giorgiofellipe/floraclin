import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { addUserMembership } from '@/db/queries/admin-users'
import { addMembershipSchema } from '@/validations/admin'
import { handleApiError } from '@/lib/api-error'

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
    return handleApiError(error, request)
  }
}
