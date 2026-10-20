import { NextResponse } from 'next/server'
import { listTenantsWithDueRepasses, postDueRepassesTx } from '@/db/queries/card-payments'
import { handleApiError } from '@/lib/api-error'
import { withCronMonitor } from '@/lib/cron-monitor'
import { brToday } from '@/lib/dates'
import { reportSideEffectFailure } from '@/lib/observability'
import { withTransaction } from '@/lib/tenant'

// 09:00 UTC is 06:00 America/Sao_Paulo; the BR day comes from brToday(), not the host clock.
const MONITOR_SLUG = 'card-repasses'
const MONITOR_SCHEDULE = '0 9 * * *'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await withCronMonitor(MONITOR_SLUG, MONITOR_SCHEDULE, async () => {
      const todayYmd = brToday()
      const tenantIds = await listTenantsWithDueRepasses(todayYmd)
      let posted = 0
      let failedTenants = 0

      for (const tenantId of tenantIds) {
        try {
          posted += await withTransaction((tx) => postDueRepassesTx(tx, tenantId, { todayYmd }))
        } catch (error) {
          failedTenants++
          reportSideEffectFailure(error, {
            area: 'card-repasses',
            step: 'post-due',
            extra: { tenantId },
          })
        }
      }

      return { posted, failedTenants }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return handleApiError(error, request)
  }
}
