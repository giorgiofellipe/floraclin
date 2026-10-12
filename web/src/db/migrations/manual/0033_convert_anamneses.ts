/**
 * Converts every legacy anamnesis row (responses IS NULL) to the template-based
 * shape. Prints counts only, never answers. Exits 1 when rows remain unconverted.
 *
 * Run:
 * npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_convert_anamneses.ts --dry-run
 * npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0033_convert_anamneses.ts
 */
import { sql } from 'drizzle-orm'
import { db } from '../../client'
import { convertLegacyAnamnesis, type LegacyAnamnesisRow } from '../../../lib/anamnesis/convert-legacy'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '../../../lib/anamnesis/default-template'

const dryRun = process.argv.includes('--dry-run')

function rowsFromExecuteResult<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : (((result as { rows?: T[] }).rows ?? []) as T[])
}

type Row = LegacyAnamnesisRow & { id: string; updated_at: string }

async function main() {
  const pending = rowsFromExecuteResult<Row>(await db.execute(sql`
    select id, updated_at::text as updated_at, main_complaint, patient_goals, medical_history, medications,
           allergies, previous_surgeries, chronic_conditions, is_pregnant, is_breastfeeding, lifestyle,
           skincare_routine, previous_aesthetic_treatments
    from floraclin.anamneses where responses is null
  `))
  console.log(`${pending.length} row(s) to convert${dryRun ? ' (dry run)' : ''}`)
  if (dryRun) return

  const snapshot = JSON.stringify(DEFAULT_ANAMNESIS_TEMPLATE.sections)
  let converted = 0
  for (const row of pending) {
    const responses = JSON.stringify(convertLegacyAnamnesis(row))
    // updated_at stays untouched: it is the optimistic-lock token the open forms hold.
    const updated = rowsFromExecuteResult<{ id: string }>(await db.execute(sql`
      update floraclin.anamneses
      set template_version = ${DEFAULT_ANAMNESIS_TEMPLATE.version},
          template_snapshot = ${snapshot}::jsonb,
          responses = ${responses}::jsonb
      where id = ${row.id} and responses is null and updated_at = ${row.updated_at}::timestamptz
      returning id
    `))
    converted += updated.length
  }

  const [{ remaining }] = rowsFromExecuteResult<{ remaining: number }>(await db.execute(sql`
    select count(*)::int as remaining from floraclin.anamneses where responses is null
  `))
  console.log(`converted ${converted}; ${remaining} row(s) still unconverted`)
  if (remaining > 0) process.exitCode = 1
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
