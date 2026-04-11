import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPractitioners } from '@/db/queries/appointments'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const data = await listPractitioners(ctx.tenantId)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
