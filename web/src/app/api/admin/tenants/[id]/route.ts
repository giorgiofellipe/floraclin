import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { updateTenantSchema } from '@/validations/admin'
import { ADMIN_SLUG_TAKEN, getTenantDetail, updateTenantAdmin } from '@/db/queries/admin-tenants'
import { getLifecycleHistory } from '@/db/queries/lifecycle'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin()

    const { id } = await params
    const tenant = await getTenantDetail(id)

    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ ...tenant, lifecycle: await getLifecycleHistory(id) })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requirePlatformAdmin()

    const { id } = await params
    const body = await request.json()
    const parsed = updateTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const tenant = await updateTenantAdmin(id, parsed.data, admin.userId)

    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: tenant })
  } catch (error) {
    if (error instanceof BusinessError && error.code === ADMIN_SLUG_TAKEN) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return handleApiError(error, request)
  }
}
