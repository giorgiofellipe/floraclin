import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant, updateTenantSettings } from '@/db/queries/tenants'
import { canManageTemplates, isWhatsAppEnabled, syncTemplatesForTenant } from '@/lib/whatsapp'
import { resolveTemplatePrefix } from '@/lib/whatsapp-blueprints'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!isWhatsAppEnabled(settings)) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner' || !canManageTemplates(settings)) {
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
    return handleApiError(error, request)
  }
}
