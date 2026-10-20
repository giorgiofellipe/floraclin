/**
 * Removes the obsolete appointment_reminder template: appointment_confirmation
 * replaced it in 0019, and nothing sends it since.
 *
 * Deletes every appointment_reminder template from Meta (the system one and
 * any clinic's own), then its local row, then the automation rows that still
 * carry the old trigger. A row whose Meta delete fails is kept, so a re-run
 * retries it. Meta keeps the deleted names on a ~30-day cooldown.
 *
 * Run from web/: npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0042_remove_appointment_reminder.ts [--dry-run]
 */
import { db } from '../../client'
import { whatsappAutomations, whatsappTemplates } from '../../schema'
import { eq } from 'drizzle-orm'
import { deleteTemplate } from '../../../lib/whatsapp'

const PURPOSE_KEY = 'appointment_reminder'
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const templates = await db
    .select({
      id: whatsappTemplates.id,
      tenantId: whatsappTemplates.tenantId,
      name: whatsappTemplates.name,
      systemTemplate: whatsappTemplates.systemTemplate,
    })
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.purposeKey, PURPOSE_KEY))

  console.log(`${dryRun ? '[dry-run] ' : ''}${templates.length} ${PURPOSE_KEY} template(s)`)

  const failed: string[] = []
  for (const template of templates) {
    const label = `${template.name}${template.systemTemplate ? ' (system)' : ''}`
    if (dryRun) {
      console.log(`  would delete ${label}`)
      continue
    }
    try {
      await deleteTemplate(template.tenantId, template.name)
      await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, template.id))
      console.log(`  deleted ${label}`)
    } catch (err) {
      failed.push(label)
      console.error(`  failed ${label}:`, err instanceof Error ? err.message : err)
    }
  }

  const automations = await db
    .select({ id: whatsappAutomations.id, tenantId: whatsappAutomations.tenantId })
    .from(whatsappAutomations)
    .where(eq(whatsappAutomations.trigger, PURPOSE_KEY))

  if (dryRun) {
    console.log(`[dry-run] would delete ${automations.length} ${PURPOSE_KEY} automation row(s)`)
  } else if (automations.length > 0) {
    await db.delete(whatsappAutomations).where(eq(whatsappAutomations.trigger, PURPOSE_KEY))
    console.log(`deleted ${automations.length} ${PURPOSE_KEY} automation row(s)`)
  }

  if (failed.length > 0) {
    console.error(`${failed.length} template(s) not deleted, re-run to retry: ${failed.join(', ')}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
