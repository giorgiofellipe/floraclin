import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { approveTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendApprovalEmail } from '@/lib/email'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformAdmin()
  const { id } = await params

  const tenant = await approveTenant(id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
  }

  const ownerEmail = await getTenantOwnerEmail(id)
  if (ownerEmail) {
    sendApprovalEmail(ownerEmail, tenant.name).catch(() => {})
  }

  return NextResponse.json({ data: tenant })
}
