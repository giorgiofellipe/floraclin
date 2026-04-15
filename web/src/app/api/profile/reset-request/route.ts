import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users, verificationTokens } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { sendPasswordResetEmail } from '@/lib/email'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'E-mail é obrigatório' }, { status: 400 })
    }

    // Check if user exists
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)

    // Always return success (don't reveal if email exists)
    if (!user) {
      return NextResponse.json({ success: true })
    }

    // Generate token — store hash, send raw
    const rawToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Delete any existing tokens for this email
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, email.toLowerCase()))

    // Insert hashed token
    await db.insert(verificationTokens).values({
      identifier: email.toLowerCase(),
      token: hashedToken,
      expires,
    })

    // Send email with the raw token
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email.toLowerCase())}`

    await sendPasswordResetEmail(email, resetUrl)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Password reset request error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
