import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
})

export async function PUT(request: Request) {
  try {
    const ctx = await getAuthContext()
    const body = await request.json()
    const parsed = changePasswordSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors.newPassword?.[0] ?? 'Dados inválidos' },
        { status: 400 }
      )
    }

    // Get current user
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // If user already has a password, verify the current one
    if (user.passwordHash) {
      if (!parsed.data.currentPassword) {
        return NextResponse.json({ error: 'Senha atual é obrigatória' }, { status: 400 })
      }
      const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)
      if (!valid) {
        return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
      }
    }
    // If no password set (magic link/OAuth user), allow setting without current password

    const hash = await bcrypt.hash(parsed.data.newPassword, 10)
    await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId))

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Password API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
