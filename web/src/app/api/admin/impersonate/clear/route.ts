import { NextResponse } from 'next/server'
import { requirePlatformAdmin, getUserTenants, setActiveTenant } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const context = await requirePlatformAdmin()
    const tenants = await getUserTenants(context.userId)

    if (tenants.length === 0) {
      return NextResponse.json({ error: 'Nenhuma clínica encontrada' }, { status: 404 })
    }

    await setActiveTenant(tenants[0].tenantId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
