/**
 * Rewrite every stored phone into the canonical 55 + DDD + 9 + subscriber form.
 *
 * Two columns hold a value produced by `normalizeBrPhone` and are matched with
 * string equality, so a mixed set of formats silently breaks routing:
 *   - whatsapp_conversations.phone_number  (shared-number tenant resolution,
 *     conversation upsert, the 24h open-window check)
 *   - prospects.phone                      (getProspectByPhone)
 *
 * patients.phone is deliberately untouched. It holds what the clinic typed and
 * is queried by comparing digits, not by equality.
 *
 * Dry run by default. Pass --yes to write. Exits non-zero when any row is left
 * holding a non-canonical phone, because those are exactly the rows the webhook
 * will keep failing to route.
 *
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones -- --yes
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { prospects, whatsappConversations } from '@/db/schema'
import { normalizeBrPhone } from '@/lib/phone'

const apply = process.argv.includes('--yes')

type TableName = 'whatsapp_conversations' | 'prospects'

interface Row {
  table: TableName
  id: string
  tenantId: string
  phone: string
  /**
   * Whether a uniqueness rule actually covers this row.
   *
   * `uq_whatsapp_conversations_tenant_phone` is unconditional, so every
   * conversation counts. `uq_prospects_tenant_phone` is partial, applying only
   * while the stage is not terminal, so a converted or lost lead can share a
   * number with a live one and is not a collision.
   */
  unique: boolean
}

interface Change extends Row {
  to: string
}

/**
 * Read both tables ONCE.
 *
 * The changes and the collision index are derived from the same snapshot on
 * purpose. Reading twice puts live traffic between the two queries, and a row
 * written in that gap lands in one view but not the other, which is how a real
 * collision goes unreported.
 */
async function loadRows(): Promise<Row[]> {
  const [convRows, prospectRows] = await Promise.all([
    db
      .select({
        id: whatsappConversations.id,
        tenantId: whatsappConversations.tenantId,
        phone: whatsappConversations.phoneNumber,
      })
      .from(whatsappConversations),
    db
      .select({
        id: prospects.id,
        tenantId: prospects.tenantId,
        phone: prospects.phone,
        stage: prospects.stage,
        deletedAt: prospects.deletedAt,
      })
      .from(prospects),
  ])

  return [
    ...convRows.map((r) => ({
      table: 'whatsapp_conversations' as const,
      id: r.id,
      tenantId: r.tenantId,
      phone: r.phone,
      unique: true,
    })),
    ...prospectRows.map((r) => ({
      table: 'prospects' as const,
      id: r.id,
      tenantId: r.tenantId,
      phone: r.phone,
      unique: r.stage !== 'convertido' && r.stage !== 'perdido' && !r.deletedAt,
    })),
  ]
}

/**
 * Rows whose normalized value would land on a value another row already holds.
 *
 * Reported, never merged: deciding which conversation history or which lead
 * survives is not a migration's call.
 */
function findCollisions(changes: Change[], rows: Row[]): Set<string> {
  const holders = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.unique) continue
    const key = `${r.table}:${r.tenantId}:${normalizeBrPhone(r.phone)}`
    holders.set(key, [...(holders.get(key) ?? []), r.id])
  }

  const collisions = new Set<string>()
  for (const c of changes) {
    if (!c.unique) continue
    const key = `${c.table}:${c.tenantId}:${c.to}`
    if ((holders.get(key) ?? []).some((id) => id !== c.id)) collisions.add(c.id)
  }
  return collisions
}

async function run(): Promise<number> {
  const rows = await loadRows()
  const changes: Change[] = rows
    .map((r) => ({ ...r, to: normalizeBrPhone(r.phone) }))
    .filter((c) => c.phone !== c.to)

  const collisions = findCollisions(changes, rows)
  const safe = changes.filter((c) => !collisions.has(c.id))
  const skipped = changes.filter((c) => collisions.has(c.id))

  const countIn = (t: TableName) => safe.filter((c) => c.table === t).length

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — phone normalization\n`)
  console.log(`whatsapp_conversations: ${countIn('whatsapp_conversations')} row(s) to rewrite`)
  console.log(`prospects:              ${countIn('prospects')} row(s) to rewrite\n`)

  for (const c of safe) {
    console.log(`  ${c.table.padEnd(23)} ${c.phone.padEnd(20)} -> ${c.to}`)
  }

  if (skipped.length > 0) {
    console.log(`\n  ${skipped.length} row(s) SKIPPED — would collide with an existing row:`)
    for (const c of skipped) {
      console.log(`  ${c.table.padEnd(23)} ${c.phone.padEnd(20)} -> ${c.to}  (id ${c.id})`)
    }
    console.log('  Merge these by hand. The migration will not pick a winner.')
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --yes to apply.\n')
    return skipped.length > 0 ? 1 : 0
  }

  // One transaction. A half-applied run leaves exactly the mixed formats this
  // script exists to remove, and the collision set on the retry would then be
  // computed against a table that is part old and part new.
  await db.transaction(async (tx) => {
    for (const c of safe) {
      if (c.table === 'whatsapp_conversations') {
        await tx
          .update(whatsappConversations)
          .set({ phoneNumber: c.to })
          .where(eq(whatsappConversations.id, c.id))
      } else {
        await tx.update(prospects).set({ phone: c.to }).where(eq(prospects.id, c.id))
      }
    }
  })

  console.log(`\nRewrote ${safe.length} row(s).`)
  if (skipped.length > 0) {
    console.log(`${skipped.length} row(s) still hold a non-canonical phone and will not route.`)
  }
  console.log('')
  return skipped.length > 0 ? 1 : 0
}

// Exit from the caller rather than mid-run, so stdout is fully flushed. This
// output is the only record of what the migration did.
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
