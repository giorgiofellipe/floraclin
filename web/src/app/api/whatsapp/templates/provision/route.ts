import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getTenant, updateTenantSettings } from '@/db/queries/tenants'
import { listTemplates, upsertTemplate, updateLocalTemplate } from '@/db/queries/whatsapp'
import { getTemplates, createTemplate as createMetaTemplate, isWhatsAppEnabled } from '@/lib/whatsapp'
import { TEMPLATE_BLUEPRINTS, generateTemplateName } from '@/lib/whatsapp-blueprints'
import { handleApiError } from '@/lib/api-error'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

    let prefix = settings?.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      prefix = generateTemplateName(tenant!.name, '').replace(/_$/, '')
      await updateTenantSettings(ctx.tenantId, { whatsapp_template_prefix: prefix })
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
      })
      synced++
    }

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
    return handleApiError(error, request)
  }
}
