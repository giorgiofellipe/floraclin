/**
 * Reruns the 0034 backfill for rows the previous deploy wrote while 0034 was
 * already applied: installments without fine, interest or grace terms,
 * cancelled installments without cancelled_at, and renegotiation replacements
 * without created_from_renegotiation. Idempotent.
 *
 * Exits 1 while any row is left (with --dry-run, while any row needs it).
 *
 * Run from web/: npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0034_backfill_installment_terms.ts [--dry-run]
 */
import { sql } from 'drizzle-orm'
import { db } from '../../client'

const dryRun = process.argv.includes('--dry-run')

const MISSING_TERMS = sql`(
  i.applied_fine_type IS NULL
  OR i.applied_fine_value IS NULL
  OR i.applied_interest_rate IS NULL
  OR i.applied_grace_period_days IS NULL
)`

const MISSING_CANCELLED_AT = sql`(i.status = 'cancelled' AND i.cancelled_at IS NULL)`

const UNFLAGGED_REPLACEMENT = sql`(
  fe.created_from_renegotiation = false
  AND (
    fe.id IN (SELECT rl.new_entry_id FROM floraclin.renegotiation_links rl)
    OR EXISTS (
      SELECT 1 FROM floraclin.audit_logs al
      WHERE al.tenant_id = fe.tenant_id
        AND al.entity_type = 'financial_entry'
        AND al.action = 'create'
        AND al.entity_id = fe.id
        AND al.changes->'type'->>'new' = 'renegotiation'
    )
  )
)`

async function countRemaining() {
  const [row] = await db.execute<{ terms: number; cancelled_at: number; replacements: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM floraclin.installments i WHERE ${MISSING_TERMS}) AS terms,
      (SELECT count(*)::int FROM floraclin.installments i WHERE ${MISSING_CANCELLED_AT}) AS cancelled_at,
      (SELECT count(*)::int FROM floraclin.financial_entries fe WHERE ${UNFLAGGED_REPLACEMENT}) AS replacements
  `)
  return { terms: Number(row.terms), cancelledAt: Number(row.cancelled_at), replacements: Number(row.replacements) }
}

function report(label: string, counts: Awaited<ReturnType<typeof countRemaining>>) {
  console.log(
    `${label}: ${counts.terms} installments without terms, ${counts.cancelledAt} cancelled without cancelled_at, ${counts.replacements} replacements unflagged`,
  )
}

async function main() {
  const before = await countRemaining()
  report('Before', before)

  if (dryRun) {
    process.exit(before.terms + before.cancelledAt + before.replacements > 0 ? 1 : 0)
  }

  await db.transaction(async (tx) => {
    // Defaults match loadInstallmentTerms for a tenant without a settings row.
    await tx.execute(sql`
      UPDATE floraclin.installments i
      SET
        applied_fine_type = COALESCE(i.applied_fine_type, (SELECT fs.fine_type FROM floraclin.financial_settings fs WHERE fs.tenant_id = i.tenant_id), 'percentage'),
        applied_fine_value = COALESCE(i.applied_fine_value, (SELECT fs.fine_value FROM floraclin.financial_settings fs WHERE fs.tenant_id = i.tenant_id), 2.00),
        applied_interest_rate = COALESCE(i.applied_interest_rate, (SELECT fs.monthly_interest_percent FROM floraclin.financial_settings fs WHERE fs.tenant_id = i.tenant_id), 1.00),
        applied_grace_period_days = COALESCE(i.applied_grace_period_days, (SELECT fs.grace_period_days FROM floraclin.financial_settings fs WHERE fs.tenant_id = i.tenant_id), 0)
      WHERE ${MISSING_TERMS}
    `)

    await tx.execute(sql`
      UPDATE floraclin.installments i
      SET cancelled_at = COALESCE(
        (
          SELECT max(al.created_at)
          FROM floraclin.audit_logs al
          WHERE al.tenant_id = i.tenant_id
            AND al.entity_type = 'financial_entry'
            AND al.action = 'update'
            AND al.entity_id = i.financial_entry_id
            AND al.changes->'status'->>'new' IN ('cancelled', 'renegotiated')
        ),
        fe.updated_at
      )
      FROM floraclin.financial_entries fe
      WHERE fe.id = i.financial_entry_id AND ${MISSING_CANCELLED_AT}
    `)

    await tx.execute(sql`
      UPDATE floraclin.financial_entries fe
      SET created_from_renegotiation = true
      WHERE ${UNFLAGGED_REPLACEMENT}
    `)
  })

  const after = await countRemaining()
  report('After', after)
  process.exit(after.terms + after.cancelledAt + after.replacements > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
