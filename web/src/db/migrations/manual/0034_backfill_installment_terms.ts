/**
 * Reruns the parts of the 0034 backfill the previous deploy can still need
 * while 0034 is already applied: cancelled installments without cancelled_at,
 * and renegotiation replacements without created_from_renegotiation.
 * Idempotent.
 *
 * Exits 1 while any row is left (with --dry-run, while any row needs it).
 *
 * Run from web/: npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json src/db/migrations/manual/0034_backfill_installment_terms.ts [--dry-run]
 */
import { sql } from 'drizzle-orm'
import { db } from '../../client'

const dryRun = process.argv.includes('--dry-run')

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
  const [row] = await db.execute<{ cancelled_at: number; replacements: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM floraclin.installments i WHERE ${MISSING_CANCELLED_AT}) AS cancelled_at,
      (SELECT count(*)::int FROM floraclin.financial_entries fe WHERE ${UNFLAGGED_REPLACEMENT}) AS replacements
  `)
  return { cancelledAt: Number(row.cancelled_at), replacements: Number(row.replacements) }
}

function report(label: string, counts: Awaited<ReturnType<typeof countRemaining>>) {
  console.log(
    `${label}: ${counts.cancelledAt} cancelled without cancelled_at, ${counts.replacements} replacements unflagged`,
  )
}

async function main() {
  const before = await countRemaining()
  report('Before', before)

  if (dryRun) {
    process.exit(before.cancelledAt + before.replacements > 0 ? 1 : 0)
  }

  await db.transaction(async (tx) => {
    // Same expression as the cancelled_at backfill in 0034.
    await tx.execute(sql`
      UPDATE floraclin.installments i
      SET cancelled_at = COALESCE(
        (
          SELECT min(al.created_at)
          FROM floraclin.audit_logs al
          WHERE al.tenant_id = i.tenant_id
            AND al.entity_type = 'financial_entry'
            AND al.action = 'update'
            AND al.entity_id = i.financial_entry_id
            AND al.changes->'status'->>'new' IN ('cancelled', 'renegotiated')
            AND al.created_at > COALESCE(
              (
                SELECT max(act.created_at)
                FROM floraclin.audit_logs act
                WHERE act.tenant_id = i.tenant_id
                  AND act.entity_type = 'financial_entry'
                  AND act.action = 'update'
                  AND act.entity_id = i.financial_entry_id
                  AND act.changes->'status'->>'old' IN ('cancelled', 'renegotiated')
                  AND act.changes->'status'->>'new' NOT IN ('cancelled', 'renegotiated')
              ),
              '-infinity'::timestamptz
            )
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
  process.exit(after.cancelledAt + after.replacements > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
