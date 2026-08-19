import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { approveTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendApprovalEmail } from '@/lib/email'
import { notifyDiscord } from '@/lib/discord'
import { handleApiError } from '@/lib/api-error'
import { reportSideEffectFailure } from '@/lib/observability'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params

    const tenant = await approveTenant(id)
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
    }

    const ownerEmail = await getTenantOwnerEmail(id)
    if (ownerEmail) {
      // An approval e-mail that never arrives is a clinic sitting at a
      // pending screen wondering why nothing happened.
      void sendApprovalEmail(ownerEmail, tenant.name).catch(err =>
        reportSideEffectFailure(err, { area: 'admin', step: 'approval_email' }),
      )
    }

    await notifyDiscord({ kind: 'clinic.approved', tenantName: tenant.name, tenantId: id })

    return NextResponse.json({ data: tenant })
  } catch (error) {
    return handleApiError(error, req)
  }
}
