import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { listPlans } from '@/db/queries/subscriptions'

export async function GET() {
  try {
    await getAuthContext()

    const activePlans = await listPlans(true)

    return NextResponse.json({ data: activePlans })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Billing plans error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
