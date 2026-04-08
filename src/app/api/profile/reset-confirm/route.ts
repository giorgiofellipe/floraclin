import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  try {
    const { token, email, newPassword } = await request.json()

    if (!token || !email || !newPassword) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres' }, { status: 400 })
    }

    // Find and validate token
    const [tokenRow] = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, email.toLowerCase()),
          eq(verificationTokens.token, token)
        )
      )
      .limit(1)

    if (!tokenRow) {
      return NextResponse.json({ error: 'Link inválido ou expirado' }, { status: 400 })
    }

    if (new Date() > tokenRow.expires) {
      // Clean up expired token
      await db
        .delete(verificationTokens)
        .where(eq(verificationTokens.token, token))
      return NextResponse.json({ error: 'Link expirado. Solicite um novo.' }, { status: 400 })
    }

    // Hash and update password
    const hash = await bcrypt.hash(newPassword, 10)
    await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.email, email.toLowerCase()))

    // Delete used token
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.token, token))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Password reset confirm error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
