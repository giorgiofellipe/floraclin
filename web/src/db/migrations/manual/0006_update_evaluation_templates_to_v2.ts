/**
 * Update evaluation templates to PDF v2 content for all existing tenants.
 * Only updates templates whose procedure type category has a matching default.
 * Skips categories we didn't rewrite (botox, filler, skincare — those stay as-is).
 * Bumps the version number on each updated template.
 *
 * ALREADY RAN: 2026-04-30 (twice — second run after fixing misclassified procedure type categories)
 * DO NOT RE-RUN — not idempotent (bumps version each time)
 *
 * Run: DATABASE_URL="..." npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0006_update_evaluation_templates_to_v2.ts
 */
import { db } from '../../client'
import { evaluationTemplates, procedureTypes, tenants } from '../../schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { defaultTemplates } from '../../../lib/default-evaluation-templates'
import type { ProcedureCategory } from '../../../types/evaluation'

// Only update the 5 categories we rewrote with PDF v2 content
const UPDATED_CATEGORIES: ProcedureCategory[] = [
  'biostimulator',
  'skinbooster',
  'enzima',
  'limpeza_pele',
  'microagulhamento',
]

// Same mapping as onboarding
const categoryToTemplateCategory: Record<string, ProcedureCategory> = {
  botox: 'botox',
  filler: 'filler',
  biostimulator: 'biostimulator',
  skinbooster: 'skinbooster',
  microagulhamento: 'microagulhamento',
  peel: 'limpeza_pele',
  enzima: 'enzima',
  limpeza_pele: 'limpeza_pele',
  skincare: 'skincare',
  laser: 'skincare',
  outros: 'skincare',
}

async function main() {
  const allTenants = await db.select({ id: tenants.id }).from(tenants)
  console.log(`Found ${allTenants.length} tenants`)

  let updated = 0
  let skipped = 0
  let created = 0

  for (const tenant of allTenants) {
    // Get all procedure types for this tenant
    const types = await db
      .select({
        id: procedureTypes.id,
        name: procedureTypes.name,
        category: procedureTypes.category,
      })
      .from(procedureTypes)
      .where(eq(procedureTypes.tenantId, tenant.id))

    for (const pt of types) {
      const templateCategory = categoryToTemplateCategory[pt.category]
      if (!templateCategory) continue

      const defaultTemplate = defaultTemplates.find((t) => t.category === templateCategory)
      if (!defaultTemplate) continue

      // Check if tenant has an existing template for this procedure type
      const [existing] = await db
        .select({
          id: evaluationTemplates.id,
          version: evaluationTemplates.version,
          sections: evaluationTemplates.sections,
        })
        .from(evaluationTemplates)
        .where(
          and(
            eq(evaluationTemplates.tenantId, tenant.id),
            eq(evaluationTemplates.procedureTypeId, pt.id),
            isNull(evaluationTemplates.deletedAt)
          )
        )
        .limit(1)

      if (existing) {
        const sections = existing.sections as unknown[]
        const isEmpty = !sections || !Array.isArray(sections) || sections.length === 0
        const isRewrittenCategory = UPDATED_CATEGORIES.includes(templateCategory)

        if (isEmpty || isRewrittenCategory) {
          // Update: blank templates get defaults, rewritten categories get PDF v2
          await db
            .update(evaluationTemplates)
            .set({
              sections: defaultTemplate.sections,
              name: defaultTemplate.name,
              version: sql`${evaluationTemplates.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(evaluationTemplates.id, existing.id))

          const reason = isEmpty ? 'blank → default' : 'v2 update'
          console.log(`  [${tenant.id}] ${pt.name} (${templateCategory}): ${reason} v${existing.version} → v${existing.version + 1}`)
          updated++
        } else {
          skipped++
        }
      } else {
        // Create template if missing entirely
        await db.insert(evaluationTemplates).values({
          tenantId: tenant.id,
          procedureTypeId: pt.id,
          name: defaultTemplate.name,
          sections: defaultTemplate.sections,
          isActive: true,
          version: 1,
        })
        console.log(`  [${tenant.id}] ${pt.name} (${templateCategory}): created`)
        created++
      }
    }
  }

  console.log(`\nDone: ${updated} updated, ${created} created, ${skipped} skipped`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
