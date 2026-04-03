import { NextResponse } from 'next/server'
import { requirePlatformAdmin, setActiveTenant } from '@/lib/auth'
import { impersonateSchema } from '@/validations/admin'

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()
    const body = await request.json()
    const parsed = impersonateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }
    await setActiveTenant(parsed.data.tenantId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Impersonate API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
