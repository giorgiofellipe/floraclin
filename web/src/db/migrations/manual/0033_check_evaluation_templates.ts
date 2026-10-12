/**
 * Read-only pre-merge check: reports stored evaluation templates that fail
 * formSectionsSchema, so they can be fixed before template saves enforce it.
 * Exits 1 when any template fails.
 *
 * Run: npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_check_evaluation_templates.ts
 */
import { isNull } from 'drizzle-orm'
import { db } from '../../client'
import { evaluationTemplates } from '../../schema'
import { formSectionsSchema } from '../../../lib/forms/sections-schema'

async function main() {
  const rows = await db
    .select({
      id: evaluationTemplates.id,
      tenantId: evaluationTemplates.tenantId,
      procedureTypeId: evaluationTemplates.procedureTypeId,
      name: evaluationTemplates.name,
      sections: evaluationTemplates.sections,
    })
    .from(evaluationTemplates)
    .where(isNull(evaluationTemplates.deletedAt))

  let failures = 0
  for (const row of rows) {
    const result = formSectionsSchema.safeParse(row.sections)
    if (result.success) continue
    failures++
    const messages = [...new Set(result.error.issues.map((i) => i.message))].join('; ')
    console.log(`${row.tenantId} ${row.id} ${row.name}: ${messages}`)
  }

  console.log(`${failures} of ${rows.length} templates fail`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
