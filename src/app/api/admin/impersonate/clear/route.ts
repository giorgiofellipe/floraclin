import { NextResponse } from 'next/server'
import { requirePlatformAdmin, getUserTenants, setActiveTenant } from '@/lib/auth'

export async function POST() {
  try {
    const context = await requirePlatformAdmin()
    const tenants = await getUserTenants(context.userId)

    if (tenants.length === 0) {
      return NextResponse.json({ error: 'Nenhuma clínica encontrada' }, { status: 404 })
    }

    await setActiveTenant(tenants[0].tenantId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Clear impersonation API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
