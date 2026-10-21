import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { handleApiError } from '@/lib/api-error'
import { getTenantReferralAdminView } from '@/db/queries/referrals'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const data = await getTenantReferralAdminView(id)
    return NextResponse.json({ data })
  } catch (error) {
    return handleApiError(error, req)
  }
}
