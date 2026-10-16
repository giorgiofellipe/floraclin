import { NextRequest, NextResponse } from 'next/server'
import { findLifecycleSendForClick, recordLifecycleClick } from '@/db/queries/lifecycle'
import { lifecycleDestination, lifecycleDestinationForMessage } from '@/lib/lifecycle-attribution'
import { reportSideEffectFailure } from '@/lib/observability'

export const dynamic = 'force-dynamic'

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || null
}

export async function GET(request: NextRequest) {
  const sendId = request.nextUrl.searchParams.get('lc')
  const destinationKey = request.nextUrl.searchParams.get('d')
  const to = request.nextUrl.searchParams.get('to')

  if (!sendId) {
    return NextResponse.json({ error: 'Missing lifecycle click parameters' }, { status: 400 })
  }

  const send = await findLifecycleSendForClick(sendId)
  if (!send) {
    return NextResponse.json({ error: 'Unknown lifecycle send' }, { status: 404 })
  }
  if (destinationKey && destinationKey !== send.messageKey) {
    return NextResponse.json({ error: 'Lifecycle destination mismatch' }, { status: 400 })
  }

  let destination: URL
  try {
    const resolved = to
      ? lifecycleDestination(to)
      : lifecycleDestinationForMessage({
          sendId,
          messageKey: send.messageKey,
          channel: send.channel === 'whatsapp' ? 'whatsapp' : 'email',
        })
    if (!resolved) return NextResponse.json({ error: 'No lifecycle destination' }, { status: 400 })
    destination = resolved
  } catch {
    return NextResponse.json({ error: 'Invalid destination' }, { status: 400 })
  }

  try {
    await recordLifecycleClick({
      sendId,
      destination: destination.toString(),
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    })
  } catch (err) {
    reportSideEffectFailure(err, { area: 'lifecycle', step: 'click', extra: { sendId } })
  }

  return NextResponse.redirect(destination)
}
