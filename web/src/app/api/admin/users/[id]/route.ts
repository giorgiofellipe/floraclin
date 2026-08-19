import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { updateUserAdmin } from '@/db/queries/admin-users'
import { updateAdminUserSchema } from '@/validations/admin'
import { handleApiError } from '@/lib/api-error'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json()
    const parsed = updateAdminUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados invalidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const user = await updateUserAdmin(id, ctx.userId, parsed.data)
    if (!user) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    return handleApiError(error, request)
  }
}
