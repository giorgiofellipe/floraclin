import { NextResponse } from 'next/server'
import { getExpiredTrials, updateSubscriptionStatus } from '@/db/queries/subscriptions'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expiredTrials = await getExpiredTrials()

  for (const sub of expiredTrials) {
    await updateSubscriptionStatus(sub.tenantId, 'expired')
  }

  return NextResponse.json({ ok: true, expired: expiredTrials.length })
}
