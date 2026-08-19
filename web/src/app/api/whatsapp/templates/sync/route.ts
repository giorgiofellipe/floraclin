import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant, updateTenantSettings } from '@/db/queries/tenants'
import { isWhatsAppEnabled, syncTemplatesForTenant } from '@/lib/whatsapp'
import { resolveTemplatePrefix } from '@/lib/whatsapp-blueprints'

export async function POST() {
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

    // Every tenant shares the same WABA, so Meta returns every clinic's
    // templates here. Only the ones matching this tenant's prefix are ours.
    let prefix = settings?.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      prefix = resolveTemplatePrefix(tenant!.name)
      await updateTenantSettings(ctx.tenantId, { whatsapp_template_prefix: prefix })
    }

    const { synced, skipped, removed } = await syncTemplatesForTenant(ctx.tenantId, prefix)

    return NextResponse.json({ synced, skipped, removed })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
