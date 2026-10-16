import { NextRequest, NextResponse } from 'next/server'
import { recordLifecycleClick } from '@/db/queries/lifecycle'
import { lifecycleDestination } from '@/lib/lifecycle-attribution'
import { reportSideEffectFailure } from '@/lib/observability'

export const dynamic = 'force-dynamic'

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip') || null
}

export async function GET(request: NextRequest) {
  const sendId = request.nextUrl.searchParams.get('lc')
  const to = request.nextUrl.searchParams.get('to')

  if (!sendId || !to) {
    return NextResponse.json({ error: 'Missing lifecycle click parameters' }, { status: 400 })
  }

  let destination: URL
  try {
    destination = lifecycleDestination(to)
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
