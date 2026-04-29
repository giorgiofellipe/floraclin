/**
 * Seed missing consent templates (limpeza_pele, enzima, skinbooster, microagulhamento)
 * for all existing tenants.
 *
 * Run from web/: npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0005_seed_missing_consent_templates.ts
 */
import { db } from '../../client'
import { consentTemplates, tenants } from '../../schema'
import { eq, and } from 'drizzle-orm'
import { DEFAULT_CONSENT_TEMPLATES } from '../../../validations/consent'

const NEW_TYPES = ['limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento'] as const

async function main() {
  const allTenants = await db.select({ id: tenants.id }).from(tenants)
  console.log(`Found ${allTenants.length} tenants`)

  for (const tenant of allTenants) {
    for (const type of NEW_TYPES) {
      const existing = await db
        .select({ id: consentTemplates.id })
        .from(consentTemplates)
        .where(and(eq(consentTemplates.tenantId, tenant.id), eq(consentTemplates.type, type)))
        .limit(1)

      if (existing.length > 0) {
        console.log(`  [${tenant.id}] ${type}: already exists, skipping`)
        continue
      }

      const template = DEFAULT_CONSENT_TEMPLATES[type]
      await db.insert(consentTemplates).values({
        tenantId: tenant.id,
        type,
        title: template.title,
        content: template.content,
        version: 1,
        isActive: true,
      })
      console.log(`  [${tenant.id}] ${type}: created`)
    }
  }

  console.log('Done')
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
