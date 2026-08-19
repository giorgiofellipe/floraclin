import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { updateTenantSchema } from '@/validations/admin'
import { getTenantDetail, updateTenantAdmin } from '@/db/queries/admin-tenants'
import { handleApiError } from '@/lib/api-error'

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

    return NextResponse.json(tenant)
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin()

    const { id } = await params
    const body = await request.json()
    const parsed = updateTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const tenant = await updateTenantAdmin(id, parsed.data)

    if (!tenant) {
      return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: tenant })
  } catch (error) {
    return handleApiError(error, request)
  }
}
