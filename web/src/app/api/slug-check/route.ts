import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { handleApiError } from '@/lib/api-error'
import { findAvailableSlug, generateSlug } from '@/db/queries/admin-tenants'

export async function GET(request: Request) {
  try {
    const { tenantId } = await getAuthContext()
    const { searchParams } = new URL(request.url)

    const name = searchParams.get('name')?.trim()
    if (name) {
      const slug = await findAvailableSlug(db, generateSlug(name), tenantId)
      return NextResponse.json({ available: true, slug })
    }

    const slug = searchParams.get('slug')?.trim().toLowerCase()
    if (!slug) {
      return NextResponse.json({ available: false })
    }

    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), ne(tenants.id, tenantId)))
      .limit(1)

    return NextResponse.json({ available: !existing })
  } catch (error) {
    return handleApiError(error, request)
  }
}
