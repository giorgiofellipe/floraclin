import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant } from '@/db/queries/tenants'
import { upsertTemplate, markStaleTemplates } from '@/db/queries/whatsapp'
import { getTemplates, isWhatsAppEnabled } from '@/lib/whatsapp'
import { handleApiError } from '@/lib/api-error'

export async function POST(request: Request) {
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
    return handleApiError(error, request)
  }
}
