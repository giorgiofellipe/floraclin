import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { procedureTypes } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
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
    return handleApiError(error, request)
  }
}
