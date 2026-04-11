import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { patients } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    // Financial patients dropdown: owner + financial
    if (!['owner', 'financial', 'receptionist', 'practitioner'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await db
      .select({
        id: patients.id,
        fullName: patients.fullName,
      })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, ctx.tenantId),
          isNull(patients.deletedAt)
        )
      )
      .orderBy(patients.fullName)

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
