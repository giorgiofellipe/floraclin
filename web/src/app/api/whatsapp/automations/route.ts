import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const automations = await listAutomations(ctx.tenantId)
    return NextResponse.json({ data: automations })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error listing WhatsApp automations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
