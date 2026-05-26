import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { upsertTemplate, markStaleTemplates } from '@/db/queries/whatsapp'
import { getTemplates } from '@/lib/whatsapp'

export async function POST() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    const settings = tenant?.settings as Record<string, unknown> | null
    if (!settings?.whatsapp_enabled) {
      return NextResponse.json({ error: 'WhatsApp not enabled' }, { status: 400 })
    }
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const metaTemplates = await getTemplates(ctx.tenantId)

    let synced = 0
    for (const tpl of metaTemplates) {
      await upsertTemplate(ctx.tenantId, {
        metaTemplateId: tpl.id,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: tpl.status,
        components: tpl.components,
        rejectedReason: (tpl as Record<string, unknown>).rejected_reason as string | null ?? null,
      })
      synced++
    }

    const metaIds = metaTemplates.map((t) => t.id)
    const marked = await markStaleTemplates(ctx.tenantId, metaIds)

    return NextResponse.json({ synced, removed: marked })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
