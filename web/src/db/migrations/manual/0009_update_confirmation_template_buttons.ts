/**
 * Update the appointment_confirmation WhatsApp template for all tenants
 * to use quick-reply buttons instead of free-text SIM/NÃO prompts.
 *
 * Meta rejects edits on approved templates, so this deletes the old
 * template and creates a new one with the updated blueprint (BODY + BUTTONS).
 *
 * Idempotent: skips tenants whose template already has BUTTONS components.
 *
 * Run: npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0009_update_confirmation_template_buttons.ts
 */
import { db } from '../../client'
import { tenants, whatsappTemplates } from '../../schema'
import { eq, and } from 'drizzle-orm'
import { deleteTemplate, createTemplate as createMetaTemplate } from '../../../lib/whatsapp'
import { TEMPLATE_BLUEPRINTS } from '../../../lib/whatsapp-blueprints'
import { upsertTemplate } from '../../queries/whatsapp'

const BLUEPRINT = TEMPLATE_BLUEPRINTS.find((b) => b.slug === 'appointment_confirmation')!

async function main() {
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)

  const waEnabled = allTenants.filter((t) => {
    const s = t.settings as Record<string, unknown> | null
    return s?.whatsapp_enabled && s?.whatsapp_phone_number_id && s?.whatsapp_access_token
  })

  console.log(`Found ${allTenants.length} tenants, ${waEnabled.length} with WhatsApp enabled`)

  let updated = 0
  let skipped = 0
  const errors: Array<{ tenant: string; error: string }> = []

  for (const tenant of waEnabled) {
    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.tenantId, tenant.id),
          eq(whatsappTemplates.purposeKey, 'appointment_confirmation'),
        )
      )
      .limit(1)

    const components = template?.components as Array<{ type: string }> | null
    if (components?.some((c) => c.type === 'BUTTONS')) {
      console.log(`  [${tenant.name}] already has buttons — skipping`)
      skipped++
      continue
    }

    const settings = tenant.settings as Record<string, unknown>
    let prefix = settings.whatsapp_template_prefix as string | undefined
    if (!prefix) {
      console.log(`  [${tenant.name}] no template prefix configured — skipping`)
      skipped++
      continue
    }
    // Meta enforces a cooldown on deleted template names — use a distinct name
    const templateName = `${prefix}_confirm_appointment`

    try {
      // Delete old template if it exists
      if (template) {
        try {
          await deleteTemplate(tenant.id, template.name)
          console.log(`  [${tenant.name}] deleted old template "${template.name}" from Meta`)
        } catch (err) {
          console.log(`  [${tenant.name}] Meta delete warning (continuing):`, err instanceof Error ? err.message : err)
        }
        await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, template.id))
      }

      // Create new template on Meta with buttons
      const metaResult = await createMetaTemplate(tenant.id, {
        name: templateName,
        category: BLUEPRINT.category,
        language: BLUEPRINT.language,
        components: BLUEPRINT.components,
      })

      // Save new local record
      await upsertTemplate(tenant.id, {
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

      console.log(`  [${tenant.name}] created template "${templateName}" with buttons — status: ${metaResult.status || 'PENDING'}`)
      updated++

      await new Promise((r) => setTimeout(r, 300))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  [${tenant.name}] FAILED: ${msg}`)
      errors.push({ tenant: tenant.name, error: msg })
    }
  }

  console.log(`\nDone: updated=${updated}, skipped=${skipped}, errors=${errors.length}`)
  if (errors.length > 0) {
    console.log('Errors:', errors)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
