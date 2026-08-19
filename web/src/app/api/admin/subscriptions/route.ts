import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { listAllSubscriptions } from '@/db/queries/subscriptions'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | null
    const plan = searchParams.get('plan') ?? undefined
    const search = searchParams.get('search')?.trim().toLowerCase()

    const subscriptions = await listAllSubscriptions({
      status: status ?? undefined,
      planSlug: plan,
    })

    const filtered = search
      ? subscriptions.filter((s) => s.tenantName.toLowerCase().includes(search))
      : subscriptions

    return NextResponse.json({ data: filtered })
  } catch (error) {
    return handleApiError(error, request)
  }
}
