/**
 * Backfills `product_applications` for the Clínica Lumé demo tenant.
 *
 * Why this exists: the demo tenant was seeded before `buildProductApplications`
 * (see `web/src/lib/demo-seed/clinical.ts`) existed, so its 106 performed
 * `procedure_records` carry face-diagram points and clinical notes but zero
 * `product_applications` rows. The "Procedimentos realizados" traceability
 * report (`web/src/db/queries/reports/procedimentos-realizados.ts`) reads
 * exclusively from `product_applications`, so it renders empty for this
 * tenant even though 106 procedures were "performed". This script is a
 * one-time fix for that already-seeded tenant; `seed.ts` writes the same
 * rows for any FUTURE seed run, so this script should never need to run
 * twice.
 *
 * ─── Safety, all enforced before any write ──────────────────────────────
 *
 * - Operates ONLY on `DEMO_TENANT_ID` (`web/src/lib/demo-seed/config.ts`).
 *   Every SELECT is filtered by it, every INSERT carries it.
 * - Refuses to run unless that tenant's `slug === DEMO_SLUG` AND
 *   `settings.is_demo === true`. Both conditions have to hold: the id is
 *   fixed at build time, but a mismatched slug or a tenant that was never
 *   actually flagged `is_demo` is a strong signal this id got reused for
 *   something else, and this script must never write real patient data.
 * - `--dry-run` prints the plan (per-record product counts, a totals table)
 *   and writes nothing. `--yes` is required to actually write; running with
 *   neither flag does nothing but print usage.
 * - Idempotent: if the tenant already has ANY `product_applications` rows,
 *   the script refuses to run at all (in both dry-run and real mode), so a
 *   second invocation can never double up rows. There is no partial-update
 *   path -- either zero rows exist and it backfills all of them, or some
 *   already exist and it does nothing.
 */

import { pathToFileURL } from 'node:url'
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { procedureRecords, procedureTypes, productApplications, tenants } from '@/db/schema'
import { DEMO_SLUG, DEMO_TENANT_ID } from '@/lib/demo-seed/config'
import { buildProductApplications } from '@/lib/demo-seed/clinical'

const INSERT_CHUNK = 400

async function inChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await fn(rows.slice(i, i + INSERT_CHUNK))
  }
}

// ─── Safety gate ─────────────────────────────────────────────────────────

async function assertDemoTenant(): Promise<void> {
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, DEMO_TENANT_ID))
    .limit(1)

  if (!tenant) {
    throw new Error(`Refusing to run: no tenant found with id ${DEMO_TENANT_ID}.`)
  }

  if (tenant.slug !== DEMO_SLUG) {
    throw new Error(
      `Refusing to run: tenant ${DEMO_TENANT_ID} has slug "${tenant.slug}", expected "${DEMO_SLUG}". ` +
        'This id may have been reused for a different tenant -- aborting rather than risk writing real data.',
    )
  }

  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  if (settings.is_demo !== true) {
    throw new Error(
      `Refusing to run: tenant ${DEMO_TENANT_ID} (slug "${tenant.slug}") does not have settings.is_demo === true ` +
        `(got ${JSON.stringify(settings.is_demo)}). Aborting rather than risk writing real data.`,
    )
  }
}

async function assertNoExistingApplications(): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(productApplications)
    .where(eq(productApplications.tenantId, DEMO_TENANT_ID))

  const existing = Number(row?.n ?? 0)
  if (existing > 0) {
    throw new Error(
      `Refusing to run: tenant ${DEMO_TENANT_ID} already has ${existing} product_applications row(s). ` +
        'This script is not an upsert and never re-runs against a tenant that already has data.',
    )
  }
}

// ─── Planning ────────────────────────────────────────────────────────────

interface SourceRecord {
  procedureRecordId: string
  procedureName: string
  performedAt: Date
}

interface PlannedInsert {
  tenantId: string
  procedureRecordId: string
  productName: string
  activeIngredient: string
  totalQuantity: string
  quantityUnit: string
  batchNumber: string
  expirationDate: string
  applicationAreas: string
  notes: string
}

async function loadSourceRecords(): Promise<SourceRecord[]> {
  const rows = await db
    .select({
      procedureRecordId: procedureRecords.id,
      procedureName: procedureTypes.name,
      performedAt: procedureRecords.performedAt,
    })
    .from(procedureRecords)
    .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
    .where(
      and(
        eq(procedureRecords.tenantId, DEMO_TENANT_ID),
        eq(procedureTypes.tenantId, DEMO_TENANT_ID),
        isNull(procedureRecords.deletedAt),
        isNotNull(procedureRecords.performedAt),
      ),
    )
    .orderBy(asc(procedureRecords.performedAt), asc(procedureRecords.id))

  // `performedAt IS NOT NULL` is enforced by the WHERE clause; the column
  // itself is nullable so the select type still carries `Date | null`.
  return rows.map((row) => ({
    procedureRecordId: row.procedureRecordId,
    procedureName: row.procedureName,
    performedAt: row.performedAt as Date,
  }))
}

/**
 * Builds the insert rows and reports which source records produced none
 * (non-injectable procedures like "Limpeza de pele profunda" -- expected --
 * or a procedure name the generator doesn't recognize -- unexpected, logged
 * so it isn't silently swallowed).
 */
function planInserts(records: SourceRecord[]): {
  inserts: PlannedInsert[]
  unknownProcedures: string[]
  zeroApplicationRecords: number
} {
  const inserts: PlannedInsert[] = []
  const unknownProcedures = new Set<string>()
  let zeroApplicationRecords = 0

  records.forEach((record, index) => {
    let applications: ReturnType<typeof buildProductApplications>
    try {
      applications = buildProductApplications(record.procedureName, index, record.performedAt)
    } catch {
      unknownProcedures.add(record.procedureName)
      return
    }

    if (applications.length === 0) {
      zeroApplicationRecords += 1
      return
    }

    for (const app of applications) {
      inserts.push({
        tenantId: DEMO_TENANT_ID,
        procedureRecordId: record.procedureRecordId,
        productName: app.productName,
        activeIngredient: app.activeIngredient,
        totalQuantity: app.totalQuantity.toFixed(2),
        quantityUnit: app.quantityUnit,
        batchNumber: app.batchNumber,
        expirationDate: app.expirationDate,
        applicationAreas: app.applicationAreas,
        notes: app.notes,
      })
    }
  })

  return { inserts, unknownProcedures: [...unknownProcedures], zeroApplicationRecords }
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log('Usage: tsx scripts/demo-clinic/backfill-applications.ts [--dry-run | --yes]')
  console.log('')
  console.log('  --dry-run   Print the plan. Writes nothing.')
  console.log('  --yes       Actually write the planned rows.')
  console.log('')
  console.log('Exactly one of --dry-run or --yes is required.')
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run')
  const yes = process.argv.includes('--yes')

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run.')
    return 1
  }

  if (dryRun === yes) {
    // Neither flag, or both -- either way we don't know what the caller
    // wants, and the safe default is to do nothing.
    printUsage()
    return 1
  }

  console.log(`Clínica Lumé product_applications backfill${dryRun ? ' (DRY RUN, nothing will be written)' : ''}`)
  console.log(`Tenant: ${DEMO_TENANT_ID} (expected slug "${DEMO_SLUG}")`)
  console.log('')

  await assertDemoTenant()
  await assertNoExistingApplications()

  const records = await loadSourceRecords()
  const { inserts, unknownProcedures, zeroApplicationRecords } = planInserts(records)

  console.log(`procedure_records with performed_at set: ${records.length}`)
  console.log(`  -> non-injectable / zero-application records: ${zeroApplicationRecords}`)
  if (unknownProcedures.length > 0) {
    console.log(`  -> WARNING: ${unknownProcedures.length} unrecognized procedure name(s), skipped: ${unknownProcedures.join(', ')}`)
  }
  console.log(`product_applications rows planned: ${inserts.length}`)
  console.log('')

  if (inserts.length > 0) {
    console.log('Sample rows (first 5):')
    for (const row of inserts.slice(0, 5)) {
      console.log(
        `  - ${row.productName} | ${row.totalQuantity}${row.quantityUnit} | lote ${row.batchNumber} | ` +
          `val. ${row.expirationDate} | procedureRecordId=${row.procedureRecordId}`,
      )
    }
    console.log('')
  }

  if (dryRun) {
    console.log('Dry run complete. Nothing was written.')
    return 0
  }

  if (inserts.length === 0) {
    console.log('Nothing to write.')
    return 0
  }

  await db.transaction(async (tx) => {
    // Re-checked inside the transaction: the pre-flight check above is a
    // friendlier error, this one is the one that actually holds.
    await assertNoExistingApplications()
    await inChunks(inserts, (chunk) => tx.insert(productApplications).values(chunk))
  })

  console.log(`Wrote ${inserts.length} product_applications row(s) across ${records.length - zeroApplicationRecords - unknownProcedures.length} procedure_records.`)
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
