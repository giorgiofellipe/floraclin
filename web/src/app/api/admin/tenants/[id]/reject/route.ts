import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { rejectTenant, getTenantOwnerEmail } from '@/db/queries/admin-tenants'
import { sendRejectionEmail } from '@/lib/email'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformAdmin()
  const { id } = await params

  const ownerEmail = await getTenantOwnerEmail(id)
  const tenant = await rejectTenant(id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found or not pending' }, { status: 404 })
  }

  if (ownerEmail) {
    sendRejectionEmail(ownerEmail, tenant.name).catch(() => {})
  }

  return NextResponse.json({ data: tenant })
}
