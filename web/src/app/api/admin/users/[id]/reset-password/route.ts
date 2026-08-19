import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { resetUserPassword } from '@/db/queries/admin-users'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { handleApiError } from '@/lib/api-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params

    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)

    if (!user) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 })
    }

    const result = await resetUserPassword(user.email)
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, request)
  }
}
