import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { handleApiError } from '@/lib/api-error'
import { findAvailableSlug, generateSlug } from '@/db/queries/admin-tenants'
import { isBookingSlugFree } from '@/db/queries/booking-slugs'

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

    return NextResponse.json({ available: await isBookingSlugFree(db, slug, tenantId) })
  } catch (error) {
    return handleApiError(error, request)
  }
}
