import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { verifyCredentials } from '@/lib/whatsapp'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    let phoneNumberId = body.phoneNumberId as string | undefined
    let accessToken = body.accessToken as string | undefined

    if (!phoneNumberId || !accessToken) {
      const tenant = await getTenant(ctx.tenantId)
      const settings = (tenant?.settings ?? {}) as Record<string, unknown>
      if (!phoneNumberId) phoneNumberId = settings.whatsapp_phone_number_id as string | undefined
      if (!accessToken) accessToken = settings.whatsapp_access_token as string | undefined
    }

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: 'Phone Number ID e Access Token são obrigatórios' },
        { status: 400 },
      )
    }

    const result = await verifyCredentials(phoneNumberId, accessToken)
    if (result.valid) {
      return NextResponse.json({ success: true, phoneDisplay: result.phoneDisplay })
    }

    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
