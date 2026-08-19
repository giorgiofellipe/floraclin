import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { rejectTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendRejectionEmail } from '@/lib/email'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params

    const ownerEmail = await getTenantOwnerEmail(id)
    const tenant = await rejectTenant(id)
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
    }

    if (ownerEmail) {
      void sendRejectionEmail(ownerEmail, tenant.name).catch(err =>
        reportSideEffectFailure(err, { area: 'admin', step: 'rejection_email' }),
      )
    }

    return NextResponse.json({ data: tenant })
  } catch (error) {
    return handleApiError(error, req)
  }
}
