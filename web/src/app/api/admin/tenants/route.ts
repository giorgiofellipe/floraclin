import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { adminSearchSchema, createTenantSchema } from '@/validations/admin'
import { ADMIN_SLUG_TAKEN, listAllTenants, createTenantWithOwner } from '@/db/queries/admin-tenants'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin()

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') ?? ''
    const page = Number(searchParams.get('page') ?? '1')
    const limit = Number(searchParams.get('limit') ?? '20')

    const parsed = adminSearchSchema.safeParse({ search, page, limit })
    if (!parsed.success) {
      return NextResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 })
    }

    const data = await listAllTenants(parsed.data.search, parsed.data.page, parsed.data.limit)
    return NextResponse.json(data)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()

    const body = await request.json()
    const parsed = createTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const tenant = await createTenantWithOwner(parsed.data)
    return NextResponse.json({ success: true, data: tenant })
  } catch (error) {
    if (error instanceof BusinessError && error.code === ADMIN_SLUG_TAKEN) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
