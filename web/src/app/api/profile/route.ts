import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { professionalProfileSchema } from '@/validations/professional'

const updateProfileSchema = z
  .object({
    fullName: z.string().min(1, 'Nome é obrigatório').optional(),
    phone: z.string().optional(),
  })
  .merge(professionalProfileSchema)

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const [user] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        signatureData: users.signatureData,
        signatureUpdatedAt: users.signatureUpdatedAt,
        professionalTitle: users.professionalTitle,
        registryType: users.registryType,
        registryNumber: users.registryNumber,
        registryState: users.registryState,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: user })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Profile API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

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
    if (parsed.data.signatureData !== undefined) {
      updateData.signatureData = parsed.data.signatureData
      updateData.signatureUpdatedAt = new Date()
    }
    if (parsed.data.professionalTitle !== undefined)
      updateData.professionalTitle = parsed.data.professionalTitle
    if (parsed.data.registryType !== undefined) updateData.registryType = parsed.data.registryType
    if (parsed.data.registryNumber !== undefined)
      updateData.registryNumber = parsed.data.registryNumber
    if (parsed.data.registryState !== undefined)
      updateData.registryState = parsed.data.registryState

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
