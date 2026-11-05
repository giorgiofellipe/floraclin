import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const { token, email, newPassword } = await request.json()

    if (!token || !email || !newPassword) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Senha deve ter pelo menos 8 caracteres' }, { status: 400 })
    }

    // Hash the raw token to match what's stored in the database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    // Atomically delete and return the token (prevents TOCTOU race)
    const [tokenRow] = await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, email.toLowerCase()),
          eq(verificationTokens.token, hashedToken)
        )
      )
      .returning()

    if (!tokenRow) {
      return NextResponse.json({ error: 'Link inválido ou expirado' }, { status: 400 })
    }

    if (new Date() > tokenRow.expires) {
      return NextResponse.json({ error: 'Link expirado. Solicite um novo.' }, { status: 400 })
    }

    // Hash and update password
    const hash = await bcrypt.hash(newPassword, 12)
    const now = new Date()
    await db
      .update(users)
      // The reset link reached this inbox, which proves the address as much
      // as the confirmation e-mail does. Without it an invited or
      // admin-created owner who set a password this way would count as
      // unconfirmed (email-confirmation-gate.ts) and lose WhatsApp sends.
      .set({
        passwordHash: hash,
        passwordChangedAt: now,
        updatedAt: now,
        emailVerified: sql`coalesce(${users.emailVerified}, ${now.toISOString()}::timestamptz)`,
      })
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
