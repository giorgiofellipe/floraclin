/**
 * Provision the `consent_signing_link` WhatsApp template for all tenants
 * that have WhatsApp enabled. Creates the template in Meta and stores it
 * locally with the correct purposeKey so `getTemplateByPurpose` finds it.
 *
 * Idempotent: skips tenants that already have a template with
 * purposeKey = 'consent_signing_link'.
 *
 * Run: DATABASE_URL="..." npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0008_provision_consent_signing_template.ts
 */
import { db } from '../../client'
import { tenants, whatsappTemplates } from '../../schema'
import { eq } from 'drizzle-orm'
import { createTemplate as createMetaTemplate } from '../../../lib/whatsapp'
import { TEMPLATE_BLUEPRINTS, generateTemplateName } from '../../../lib/whatsapp-blueprints'

const BLUEPRINT = TEMPLATE_BLUEPRINTS.find((b) => b.slug === 'consent_signing_link')!

async function main() {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    return s?.whatsapp_enabled && s?.whatsapp_phone_number_id && s?.whatsapp_access_token
  })

  console.log(`Found ${allTenants.length} tenants, ${waEnabled.length} with WhatsApp enabled`)

  let provisioned = 0
  let skipped = 0
  const errors: Array<{ tenant: string; error: string }> = []

  for (const tenant of waEnabled) {
    const settings = tenant.settings as Record<string, unknown>

    const localTemplates = await db
      .select({ id: whatsappTemplates.id, purposeKey: whatsappTemplates.purposeKey })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.tenantId, tenant.id))

    if (localTemplates.some((t) => t.purposeKey === 'consent_signing_link')) {
      console.log(`  [${tenant.name}] already has consent_signing_link — skipping`)
      skipped++
      continue
    }

    const prefix = (settings.whatsapp_template_prefix as string) ||
      generateTemplateName(tenant.name, '').replace(/_$/, '')
    const templateName = `${prefix}_${BLUEPRINT.name}`

    try {
      const metaResult = await createMetaTemplate(tenant.id, {
        name: templateName,
        category: BLUEPRINT.category,
        language: BLUEPRINT.language,
        components: BLUEPRINT.components,
      })

      await db.insert(whatsappTemplates).values({
        tenantId: tenant.id,
        metaTemplateId: metaResult.id,
        name: templateName,
        language: BLUEPRINT.language,
        category: BLUEPRINT.category,
        status: metaResult.status || 'PENDING',
        components: BLUEPRINT.components,
        purposeKey: BLUEPRINT.purposeKey,
        blueprintSlug: BLUEPRINT.slug,
        submittedAt: new Date(),
        variableMapping: BLUEPRINT.variables,
      })

      console.log(`  [${tenant.name}] created "${templateName}" — status: ${metaResult.status || 'PENDING'}`)
      provisioned++

      // Rate-limit: Meta recommends spacing API calls
      await new Promise((r) => setTimeout(r, 300))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  [${tenant.name}] FAILED: ${msg}`)
      errors.push({ tenant: tenant.name, error: msg })
    }
  }

  console.log(`\nDone: ${provisioned} provisioned, ${skipped} skipped, ${errors.length} errors`)
  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const e of errors) console.log(`  ${e.tenant}: ${e.error}`)
  }
  process.exit(errors.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
