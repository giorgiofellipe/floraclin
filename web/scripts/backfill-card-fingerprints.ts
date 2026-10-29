/**
 * One-off: record the cards each Stripe customer has paid with into
 * billing_card_fingerprints, so the referral program's "not new" and
 * self-referral card checks have history from before the program launched.
 * first_seen_at / last_seen_at are the real charge times, not the backfill time.
 *
 * Read-only on Stripe. Sequential. Idempotent (the upsert keeps the earliest
 * first_seen_at and the latest last_seen_at).
 *
 *   pnpm --filter @floraclin/web referral:backfill-fingerprints -- --dry-run
 *   pnpm --filter @floraclin/web referral:backfill-fingerprints
 */
import { isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenantSubscriptions } from '@/db/schema'
import { recordCardFingerprints } from '@/db/queries/referrals'
import { listCustomerCardSightings } from '@/lib/stripe'

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await db
    .select({ tenantId: tenantSubscriptions.tenantId, customerId: tenantSubscriptions.stripeCustomerId })
    .from(tenantSubscriptions)
    .where(isNotNull(tenantSubscriptions.stripeCustomerId))

  console.log(`${rows.length} tenant(s) with a Stripe customer${dryRun ? ' (dry run, nothing is written)' : ''}`)

  let done = 0
  let cards = 0
  let failed = 0
  for (const row of rows) {
    done++
    if (!row.customerId) continue
    try {
      const sightings = await listCustomerCardSightings(row.customerId)
      cards += sightings.length
      if (!dryRun && sightings.length > 0) await recordCardFingerprints(row.tenantId, sightings)
      console.log(`[${done}/${rows.length}] ${row.tenantId}: ${sightings.length} card(s)`)
    } catch (err) {
      failed++
      console.error(`[${done}/${rows.length}] ${row.tenantId}: failed`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`Done. ${cards} card sighting(s)${dryRun ? ' found' : ' recorded'}, ${failed} failure(s).`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .then(() => process.exit(process.exitCode ?? 0))
