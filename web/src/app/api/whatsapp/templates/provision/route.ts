import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant, updateTenantSettings } from '@/db/queries/tenants'
import { listTemplates, upsertTemplate, updateLocalTemplate } from '@/db/queries/whatsapp'
import {
  createTemplate as createMetaTemplate,
  isWhatsAppEnabled,
  syncTemplatesForTenant,
} from '@/lib/whatsapp'
import { TEMPLATE_BLUEPRINTS, resolveTemplatePrefix } from '@/lib/whatsapp-blueprints'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

    let prefix = settings?.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      prefix = resolveTemplatePrefix(tenant!.name)
      await updateTenantSettings(ctx.tenantId, { whatsapp_template_prefix: prefix })
    }

    // Every tenant shares the same WABA, so this only imports templates that
    // match this tenant's own prefix. See syncTemplatesForTenant.
    const { synced } = await syncTemplatesForTenant(ctx.tenantId, prefix)

    const existingTemplates = await listTemplates(ctx.tenantId)
    const existingPurposeKeys = new Set(
      existingTemplates.map((t) => t.purposeKey).filter(Boolean)
    )

    for (const blueprint of TEMPLATE_BLUEPRINTS) {
      if (existingPurposeKeys.has(blueprint.purposeKey)) continue
      const expectedName = `${prefix}_${blueprint.name}`
      const match = existingTemplates.find((t) => t.name === expectedName && !t.purposeKey)
      if (match) {
        await updateLocalTemplate(ctx.tenantId, match.id, {
          purposeKey: blueprint.purposeKey,
          blueprintSlug: blueprint.slug,
          variableMapping: blueprint.variables,
        })
        existingPurposeKeys.add(blueprint.purposeKey)
      }
    }

    let provisioned = 0
    const errors: Array<{ blueprint: string; error: string }> = []

    for (const blueprint of TEMPLATE_BLUEPRINTS) {
      if (existingPurposeKeys.has(blueprint.purposeKey)) continue

      const templateName = `${prefix}_${blueprint.name}`

      try {
        const metaResult = await createMetaTemplate(ctx.tenantId, {
          name: templateName,
          category: blueprint.category,
          language: blueprint.language,
          components: blueprint.components,
        })

        await upsertTemplate(ctx.tenantId, {
          metaTemplateId: metaResult.id,
          name: templateName,
          language: blueprint.language,
          category: blueprint.category,
          status: metaResult.status || 'PENDING',
          components: blueprint.components,
          purposeKey: blueprint.purposeKey,
          blueprintSlug: blueprint.slug,
          submittedAt: new Date(),
          variableMapping: blueprint.variables,
        })
        provisioned++

        await delay(200)
      } catch (err) {
        errors.push({
          blueprint: blueprint.slug,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({ synced, provisioned, errors })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Error provisioning WhatsApp templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
