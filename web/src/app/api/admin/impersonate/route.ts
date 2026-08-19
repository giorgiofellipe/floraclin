import { NextResponse } from 'next/server'
import { requirePlatformAdmin, setActiveTenant } from '@/lib/auth'
import { impersonateSchema } from '@/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()
    const body = await request.json()
    const parsed = impersonateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }
    await setActiveTenant(parsed.data.tenantId)
    await createAuditLog({
      tenantId: parsed.data.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'impersonation',
      entityId: parsed.data.tenantId,
      changes: { action: { old: null, new: 'impersonate_start' } },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}
