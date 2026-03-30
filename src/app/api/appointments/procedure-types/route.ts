import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { procedureTypes } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

export async function GET() {
  try {
    const ctx = await getAuthContext()

    const result = await db
      .select({
        id: procedureTypes.id,
        name: procedureTypes.name,
        estimatedDurationMin: procedureTypes.estimatedDurationMin,
      })
      .from(procedureTypes)
      .where(
        and(
          eq(procedureTypes.tenantId, ctx.tenantId),
          eq(procedureTypes.isActive, true),
          isNull(procedureTypes.deletedAt)
        )
      )
      .orderBy(procedureTypes.name)

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
