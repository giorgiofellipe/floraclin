import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findLifecycleSendForClick, recordLifecycleClick, type LifecycleClickSend } from '@/db/queries/lifecycle'
import { getAppUrl } from '@/lib/app-url'
import { isLikelyLinkScanner, lifecycleClickRequest, lifecycleDestination } from '@/lib/lifecycle-attribution'
import { reportSideEffectFailure } from '@/lib/observability'

export const dynamic = 'force-dynamic'

const SEND_ID = z.string().uuid()

async function findSend(sendId: string | null): Promise<LifecycleClickSend | null> {
  if (!sendId || !SEND_ID.safeParse(sendId).success) return null
  try {
    return await findLifecycleSendForClick(sendId)
  } catch (err) {
    reportSideEffectFailure(err, { area: 'lifecycle', step: 'click_lookup', extra: { sendId } })
    return null
  }
}

export async function GET(request: NextRequest) {
  const send = await findSend(request.nextUrl.searchParams.get('lc'))
  if (!send) return NextResponse.redirect(new URL('/', getAppUrl()))

  if (!isLikelyLinkScanner(lifecycleClickRequest(request), send)) {
    await recordLifecycleClick(send).catch((err) =>
      reportSideEffectFailure(err, { area: 'lifecycle', step: 'click', extra: { sendId: send.id } }),
    )
  }
  return NextResponse.redirect(lifecycleDestination(send))
}
