/**
 * Rewrite every stored phone into the canonical 55 + DDD + 9 + subscriber form.
 *
 * Two columns hold a value produced by `normalizeBrPhone` and are matched with
 * string equality, so a mixed set of formats silently breaks routing:
 *   - whatsapp_conversations.phone_number  (shared-number tenant resolution,
 *     conversation upsert, the 24h open-window check)
 *   - prospects.phone                      (getProspectByPhone)
 *
 * patients.phone and patients.phone_secondary are rewritten too, so every
 * display and edit form sees the same shape new writes store. They use the
 * strict normalizer that patient saves validate with: a number it cannot place
 * is reported and left as typed, never rewritten into a guess.
 *
 * Dry run by default. Pass --yes to write. Each UPDATE only lands while the row
 * still holds the value that was read, so a phone edited mid-run is counted and
 * left alone instead of overwritten. Exits non-zero when any row is left
 * holding a non-canonical phone: a collision the webhook will keep failing to
 * route, a patient phone someone has to fix by hand, or a row that changed
 * under the run.
 *
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones
 *   pnpm --filter @floraclin/web whatsapp:normalize-phones -- --yes
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { patients, prospects, whatsappConversations } from '@/db/schema'
import { normalizeBrPhone, tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'

const apply = process.argv.includes('--yes')

type TableName =
  | 'whatsapp_conversations'
  | 'prospects'
  | 'patients.phone'
  | 'patients.phone_secondary'

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
   * number with a live one and is not a collision. Patients have no rule.
   */
  unique: boolean
  deleted: boolean
}

interface Change extends Row {
  to: string
}

/**
 * Read every table ONCE.
 *
 * The changes and the collision index are derived from the same snapshot on
 * purpose. Reading twice puts live traffic between the two queries, and a row
 * written in that gap lands in one view but not the other, which is how a real
 * collision goes unreported.
 */
async function loadRows(): Promise<Row[]> {
  const [convRows, prospectRows, patientRows] = await Promise.all([
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
    db
      .select({
        id: patients.id,
        tenantId: patients.tenantId,
        phone: patients.phone,
        phoneSecondary: patients.phoneSecondary,
        deletedAt: patients.deletedAt,
      })
      .from(patients),
  ])

  return [
    ...convRows.map((r) => ({
      table: 'whatsapp_conversations' as const,
      id: r.id,
      tenantId: r.tenantId,
      phone: r.phone,
      unique: true,
      deleted: false,
    })),
    ...prospectRows.map((r) => ({
      table: 'prospects' as const,
      id: r.id,
      tenantId: r.tenantId,
      phone: r.phone,
      unique: r.stage !== 'convertido' && r.stage !== 'perdido' && !r.deletedAt,
      deleted: !!r.deletedAt,
    })),
    ...patientRows.map((r) => ({
      table: 'patients.phone' as const,
      id: r.id,
      tenantId: r.tenantId,
      phone: r.phone,
      unique: false,
      deleted: !!r.deletedAt,
    })),
    ...patientRows.flatMap((r) =>
      r.phoneSecondary
        ? [{
            table: 'patients.phone_secondary' as const,
            id: r.id,
            tenantId: r.tenantId,
            phone: r.phoneSecondary,
            unique: false,
            deleted: !!r.deletedAt,
          }]
        : [],
    ),
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

const isPatientColumn = (t: TableName) => t === 'patients.phone' || t === 'patients.phone_secondary'

async function run(): Promise<number> {
  const rows = await loadRows()

  const unplaceable = rows.filter(
    (r) => isPatientColumn(r.table) && !r.deleted && !tryNormalizeBrPhoneForWhatsApp(r.phone).ok,
  )
  const changes: Change[] = rows
    .flatMap((r) => {
      if (!isPatientColumn(r.table)) return [{ ...r, to: normalizeBrPhone(r.phone) }]
      const result = tryNormalizeBrPhoneForWhatsApp(r.phone)
      return result.ok ? [{ ...r, to: result.phone }] : []
    })
    .filter((c) => c.phone !== c.to)

  const collisions = findCollisions(changes, rows)
  const safe = changes.filter((c) => !collisions.has(c.id))
  const skipped = changes.filter((c) => collisions.has(c.id))

  const countIn = (t: TableName) => safe.filter((c) => c.table === t).length

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}: phone normalization\n`)
  console.log(`whatsapp_conversations:   ${countIn('whatsapp_conversations')} row(s) to rewrite`)
  console.log(`prospects:                ${countIn('prospects')} row(s) to rewrite`)
  console.log(`patients.phone:           ${countIn('patients.phone')} row(s) to rewrite`)
  console.log(`patients.phone_secondary: ${countIn('patients.phone_secondary')} row(s) to rewrite\n`)

  for (const c of safe) {
    console.log(`  ${c.table.padEnd(25)} ${c.phone.padEnd(20)} -> ${c.to}`)
  }

  if (skipped.length > 0) {
    console.log(`\n  ${skipped.length} row(s) SKIPPED, would collide with an existing row:`)
    for (const c of skipped) {
      console.log(`  ${c.table.padEnd(25)} ${c.phone.padEnd(20)} -> ${c.to}  (id ${c.id})`)
    }
    console.log('  Merge these by hand. The migration will not pick a winner.')
  }

  if (unplaceable.length > 0) {
    console.log(`\n  ${unplaceable.length} patient phone(s) LEFT AS TYPED, not a placeable BR number:`)
    for (const r of unplaceable) {
      console.log(`  ${r.table.padEnd(25)} ${r.phone.padEnd(20)}  (id ${r.id})`)
    }
    console.log('  Fix these by hand. Saving the patient form will reject them until then.')
  }

  const leftBehind = skipped.length + unplaceable.length

  if (!apply) {
    console.log('\nNothing written. Re-run with --yes to apply.\n')
    return leftBehind > 0 ? 1 : 0
  }

  // One transaction. A half-applied run leaves exactly the mixed formats this
  // script exists to remove, and the collision set on the retry would then be
  // computed against a table that is part old and part new.
  const changedSinceRead: Change[] = []
  await db.transaction(async (tx) => {
    for (const c of safe) {
      let updated: { id: string }[]
      if (c.table === 'whatsapp_conversations') {
        updated = await tx
          .update(whatsappConversations)
          .set({ phoneNumber: c.to })
          .where(and(eq(whatsappConversations.id, c.id), eq(whatsappConversations.phoneNumber, c.phone)))
          .returning({ id: whatsappConversations.id })
      } else if (c.table === 'prospects') {
        updated = await tx
          .update(prospects)
          .set({ phone: c.to })
          .where(and(eq(prospects.id, c.id), eq(prospects.phone, c.phone)))
          .returning({ id: prospects.id })
      } else if (c.table === 'patients.phone') {
        updated = await tx
          .update(patients)
          .set({ phone: c.to })
          .where(and(eq(patients.id, c.id), eq(patients.phone, c.phone)))
          .returning({ id: patients.id })
      } else {
        updated = await tx
          .update(patients)
          .set({ phoneSecondary: c.to })
          .where(and(eq(patients.id, c.id), eq(patients.phoneSecondary, c.phone)))
          .returning({ id: patients.id })
      }
      if (updated.length === 0) changedSinceRead.push(c)
    }
  })

  console.log(`\nRewrote ${safe.length - changedSinceRead.length} row(s).`)
  if (changedSinceRead.length > 0) {
    console.log(`\n  ${changedSinceRead.length} row(s) NOT rewritten, the phone changed after it was read:`)
    for (const c of changedSinceRead) {
      console.log(`  ${c.table.padEnd(25)} ${c.phone.padEnd(20)}  (id ${c.id})`)
    }
    console.log('  Re-run to check them.')
  }
  const notCanonical = leftBehind + changedSinceRead.length
  if (notCanonical > 0) {
    console.log(`${notCanonical} row(s) may still hold a non-canonical phone.`)
  }
  console.log('')
  return notCanonical > 0 ? 1 : 0
}

// Exit from the caller rather than mid-run, so stdout is fully flushed. This
// output is the only record of what the migration did.
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
