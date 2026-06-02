import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth-config'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq, and, ne } from 'drizzle-orm'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')?.trim().toLowerCase()
  if (!slug) {
    return NextResponse.json({ available: false })
  }

  const tenantId = (session as any).tenantId as string | null

  const conditions = [eq(tenants.slug, slug)]
  if (tenantId) {
    conditions.push(ne(tenants.id, tenantId))
  }

  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(...conditions))
    .limit(1)

  return NextResponse.json({ available: !existing })
}
