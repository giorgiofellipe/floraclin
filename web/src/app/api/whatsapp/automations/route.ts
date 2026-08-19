import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'
import { isWhatsAppEnabled } from '@/lib/whatsapp'
import { handleApiError } from '@/lib/api-error'

export async function GET(request: Request) {
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
    return handleApiError(error, request)
  }
}
