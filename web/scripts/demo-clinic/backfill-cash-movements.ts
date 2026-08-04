/**
 * Backfills `cash_movements` for the Clínica Lumé demo tenant.
 *
 * Why this exists: the demo tenant was seeded before `seed.ts` wrote
 * `cash_movements` rows for its paid installments and paid expense
 * installments (see `writeCashMovements` in `seed.ts`). Its 107 installments
 * and 18 expenses were inserted already marked `paid`, which is how the seed
 * builds a screenshot-ready P&L in one shot, but that bypasses the app's
 * actual payment path (`recordPayment` / `payExpenseInstallment` in
 * `web/src/db/queries/financial.ts` and `web/src/db/queries/expenses.ts`),
 * the only place that normally writes a `cash_movements` row. So the tenant
 * has zero `cash_movements` rows, and every reader of that table --
 * `listCashMovements`, `getLedgerSummary`, `exportLedgerCSV`
 * (`web/src/db/queries/cash-movements.ts`), and therefore both the
 * "Extrato por período" report and the Financeiro ledger screen -- renders
 * empty for this tenant even though its financial totals are correct. This
 * script is a one-time fix for that already-seeded tenant; `seed.ts` writes
 * the same rows for any FUTURE seed run, so this script should never need to
 * run twice.
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
 * - `--dry-run` prints the plan (per-source counts, an inflow/outflow
 *   totals table) and writes nothing. `--yes` is required to actually
 *   write; running with neither flag does nothing but print usage.
 * - Idempotent: if the tenant already has ANY `cash_movements` rows, the
 *   script refuses to run at all (in both dry-run and real mode), so a
 *   second invocation can never double up rows. There is no partial-update
 *   path -- either zero rows exist and it backfills all of them, or some
 *   already exist and it does nothing.
 */

import { pathToFileURL } from 'node:url'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { cashMovements, expenseInstallments, expenses, financialEntries, installments, tenants } from '@/db/schema'
import { DEMO_SLUG, DEMO_TENANT_ID } from '@/lib/demo-seed/config'

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

async function assertNoExistingCashMovements(): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(cashMovements)
    .where(eq(cashMovements.tenantId, DEMO_TENANT_ID))

  const existing = Number(row?.n ?? 0)
  if (existing > 0) {
    throw new Error(
      `Refusing to run: tenant ${DEMO_TENANT_ID} already has ${existing} cash_movements row(s). ` +
        'This script is not an upsert and never re-runs against a tenant that already has data.',
    )
  }
}

// ─── Planning ────────────────────────────────────────────────────────────

interface PlannedInflow {
  amount: string
  description: string
  paymentMethod: string | null
  movementDate: Date
  patientId: string
  recordedBy: string
}

interface PlannedOutflow {
  amount: string
  description: string
  paymentMethod: string | null
  movementDate: Date
  expenseInstallmentId: string
  expenseCategoryId: string | null
  recordedBy: string
}

/**
 * Every paid installment for the demo tenant, joined back to its parent
 * `financial_entries` row for the fields `cash_movements` needs
 * (`patientId`, a description, and the user who "recorded" the payment --
 * `financial_entries.createdBy`, since no `payment_records` row exists to
 * carry a `recordedBy` of its own). Shape matches `recordPayment` step 5 in
 * `web/src/db/queries/financial.ts` exactly.
 */
async function loadPaidInstallments(): Promise<PlannedInflow[]> {
  const rows = await db
    .select({
      amount: installments.amount,
      paidAt: installments.paidAt,
      paymentMethod: installments.paymentMethod,
      patientId: financialEntries.patientId,
      description: financialEntries.description,
      createdBy: financialEntries.createdBy,
    })
    .from(installments)
    .innerJoin(financialEntries, eq(installments.financialEntryId, financialEntries.id))
    .where(
      and(
        eq(installments.tenantId, DEMO_TENANT_ID),
        eq(financialEntries.tenantId, DEMO_TENANT_ID),
        eq(installments.status, 'paid'),
        isNotNull(installments.paidAt),
      ),
    )

  return rows.map((row) => ({
    amount: row.amount,
    description: `Pagamento: ${row.description}`,
    paymentMethod: row.paymentMethod,
    // `isNotNull` above guarantees this at the SQL level; the select type
    // still carries `Date | null`.
    movementDate: row.paidAt as Date,
    patientId: row.patientId,
    recordedBy: row.createdBy,
  }))
}

/**
 * Every paid expense installment for the demo tenant, joined back to its
 * parent `expenses` row for `categoryId` and `createdBy`. Shape matches
 * `payExpenseInstallment` in `web/src/db/queries/expenses.ts` exactly,
 * including the `Despesa parcela N` description.
 */
async function loadPaidExpenseInstallments(): Promise<PlannedOutflow[]> {
  const rows = await db
    .select({
      id: expenseInstallments.id,
      installmentNumber: expenseInstallments.installmentNumber,
      amount: expenseInstallments.amount,
      paidAt: expenseInstallments.paidAt,
      paymentMethod: expenseInstallments.paymentMethod,
      categoryId: expenses.categoryId,
      createdBy: expenses.createdBy,
    })
    .from(expenseInstallments)
    .innerJoin(expenses, eq(expenseInstallments.expenseId, expenses.id))
    .where(
      and(
        eq(expenses.tenantId, DEMO_TENANT_ID),
        eq(expenseInstallments.status, 'paid'),
        isNotNull(expenseInstallments.paidAt),
      ),
    )

  return rows.map((row) => ({
    amount: row.amount,
    description: `Despesa parcela ${row.installmentNumber}`,
    paymentMethod: row.paymentMethod,
    movementDate: row.paidAt as Date,
    expenseInstallmentId: row.id,
    expenseCategoryId: row.categoryId,
    recordedBy: row.createdBy,
  }))
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log('Usage: tsx scripts/demo-clinic/backfill-cash-movements.ts [--dry-run | --yes]')
  console.log('')
  console.log('  --dry-run   Print the plan. Writes nothing.')
  console.log('  --yes       Actually write the planned rows.')
  console.log('')
  console.log('Exactly one of --dry-run or --yes is required.')
}

function sumAmounts(rows: Array<{ amount: string }>): string {
  return rows.reduce((total, row) => total + Number(row.amount), 0).toFixed(2)
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

  console.log(`Clínica Lumé cash_movements backfill${dryRun ? ' (DRY RUN, nothing will be written)' : ''}`)
  console.log(`Tenant: ${DEMO_TENANT_ID} (expected slug "${DEMO_SLUG}")`)
  console.log('')

  await assertDemoTenant()
  await assertNoExistingCashMovements()

  const inflows = await loadPaidInstallments()
  const outflows = await loadPaidExpenseInstallments()

  console.log(`paid installments: ${inflows.length} (total ${sumAmounts(inflows)})`)
  console.log(`paid expense installments: ${outflows.length} (total ${sumAmounts(outflows)})`)
  console.log(`cash_movements rows planned: ${inflows.length + outflows.length}`)
  console.log('')

  if (inflows.length > 0) {
    console.log('Sample inflow rows (first 5):')
    for (const row of inflows.slice(0, 5)) {
      console.log(
        `  - ${row.description} | R$ ${row.amount} | ${row.paymentMethod ?? 'sem método'} | ${row.movementDate.toISOString()}`,
      )
    }
    console.log('')
  }

  if (outflows.length > 0) {
    console.log('Sample outflow rows (first 5):')
    for (const row of outflows.slice(0, 5)) {
      console.log(
        `  - ${row.description} | R$ ${row.amount} | ${row.paymentMethod ?? 'sem método'} | ${row.movementDate.toISOString()}`,
      )
    }
    console.log('')
  }

  if (dryRun) {
    console.log('Dry run complete. Nothing was written.')
    return 0
  }

  if (inflows.length + outflows.length === 0) {
    console.log('Nothing to write.')
    return 0
  }

  await db.transaction(async (tx) => {
    // Re-checked inside the transaction: the pre-flight check above is a
    // friendlier error, this one is the one that actually holds.
    await assertNoExistingCashMovements()

    const inflowRows = inflows.map((row) => ({
      tenantId: DEMO_TENANT_ID,
      type: 'inflow' as const,
      amount: row.amount,
      description: row.description,
      paymentMethod: row.paymentMethod,
      movementDate: row.movementDate,
      patientId: row.patientId,
      recordedBy: row.recordedBy,
    }))

    const outflowRows = outflows.map((row) => ({
      tenantId: DEMO_TENANT_ID,
      type: 'outflow' as const,
      amount: row.amount,
      description: row.description,
      paymentMethod: row.paymentMethod,
      movementDate: row.movementDate,
      expenseInstallmentId: row.expenseInstallmentId,
      expenseCategoryId: row.expenseCategoryId,
      recordedBy: row.recordedBy,
    }))

    await inChunks([...inflowRows, ...outflowRows], (chunk) => tx.insert(cashMovements).values(chunk))
  })

  console.log(`Wrote ${inflows.length + outflows.length} cash_movements row(s) (${inflows.length} inflow, ${outflows.length} outflow).`)
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
