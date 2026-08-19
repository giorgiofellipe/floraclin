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
 * Dry run by default. Pass --yes to write.
 *
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones -- --yes
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { prospects, whatsappConversations } from '@/db/schema'
import { normalizeBrPhone } from '@/lib/phone'

const apply = process.argv.includes('--yes')

interface Change {
  table: string
  id: string
  tenantId: string
  from: string
  to: string
}

async function collectConversations(): Promise<Change[]> {
  const rows = await db
    .select({
      id: whatsappConversations.id,
      tenantId: whatsappConversations.tenantId,
      phone: whatsappConversations.phoneNumber,
    })
    .from(whatsappConversations)

  return rows
    .map((r) => ({
      table: 'whatsapp_conversations',
      id: r.id,
      tenantId: r.tenantId,
      from: r.phone,
      to: normalizeBrPhone(r.phone),
    }))
    .filter((c) => c.from !== c.to)
}

async function collectProspects(): Promise<Change[]> {
  const rows = await db
    .select({
      id: prospects.id,
      tenantId: prospects.tenantId,
      phone: prospects.phone,
    })
    .from(prospects)

  return rows
    .map((r) => ({
      table: 'prospects',
      id: r.id,
      tenantId: r.tenantId,
      from: r.phone,
      to: normalizeBrPhone(r.phone),
    }))
    .filter((c) => c.from !== c.to)
}

/**
 * Two rows for the same person in the same tenant would collide once both
 * normalize to the same string. Report them instead of merging: deciding which
 * conversation history survives is not a migration's call.
 */
function findCollisions(changes: Change[], existing: Map<string, string[]>): Change[] {
  const collisions: Change[] = []
  for (const c of changes) {
    const key = `${c.table}:${c.tenantId}:${c.to}`
    const holders = existing.get(key) ?? []
    if (holders.some((id) => id !== c.id)) collisions.push(c)
  }
  return collisions
}

async function main() {
  const [convChanges, prospectChanges] = await Promise.all([
    collectConversations(),
    collectProspects(),
  ])
  const changes = [...convChanges, ...prospectChanges]

  // Build the post-migration index so collisions are detected against the
  // normalized values, not the current mixed ones.
  const index = new Map<string, string[]>()
  const allConv = await db
    .select({
      id: whatsappConversations.id,
      tenantId: whatsappConversations.tenantId,
      phone: whatsappConversations.phoneNumber,
    })
    .from(whatsappConversations)
  const allProspects = await db
    .select({ id: prospects.id, tenantId: prospects.tenantId, phone: prospects.phone })
    .from(prospects)

  for (const r of allConv) {
    const key = `whatsapp_conversations:${r.tenantId}:${normalizeBrPhone(r.phone)}`
    index.set(key, [...(index.get(key) ?? []), r.id])
  }
  for (const r of allProspects) {
    const key = `prospects:${r.tenantId}:${normalizeBrPhone(r.phone)}`
    index.set(key, [...(index.get(key) ?? []), r.id])
  }

  const collisions = findCollisions(changes, index)
  const safe = changes.filter((c) => !collisions.includes(c))

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — phone normalization\n`)
  console.log(`whatsapp_conversations: ${convChanges.length} row(s) to rewrite`)
  console.log(`prospects:              ${prospectChanges.length} row(s) to rewrite\n`)

  for (const c of safe) {
    console.log(`  ${c.table.padEnd(23)} ${c.from.padEnd(20)} -> ${c.to}`)
  }

  if (collisions.length > 0) {
    console.log(`\n  ${collisions.length} row(s) SKIPPED — would collide with an existing row:`)
    for (const c of collisions) {
      console.log(`  ${c.table.padEnd(23)} ${c.from.padEnd(20)} -> ${c.to}  (id ${c.id})`)
    }
    console.log('  Merge these by hand. The migration will not pick a winner.')
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --yes to apply.\n')
    process.exit(0)
  }

  for (const c of safe) {
    if (c.table === 'whatsapp_conversations') {
      await db
        .update(whatsappConversations)
        .set({ phoneNumber: c.to })
        .where(eq(whatsappConversations.id, c.id))
    } else {
      await db.update(prospects).set({ phone: c.to }).where(eq(prospects.id, c.id))
    }
  }

  console.log(`\nRewrote ${safe.length} row(s).\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
