import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const updateProfileSchema = z.object({
  fullName: z.string().min(1, 'Nome é obrigatório').optional(),
  phone: z.string().optional(),
})

export async function PUT(request: Request) {
  try {
    const ctx = await getAuthContext()
    const body = await request.json()
    const parsed = updateProfileSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.fullName !== undefined) updateData.fullName = parsed.data.fullName
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone || null

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, ctx.userId))

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Profile API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
