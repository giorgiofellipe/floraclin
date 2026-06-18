import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { listAllSubscriptions } from '@/db/queries/subscriptions'

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Admin subscriptions API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
