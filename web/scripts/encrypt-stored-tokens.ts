/**
 * Encrypt the OAuth credentials that are still stored in plaintext.
 *
 * `meta_connections.access_token` holds a long-lived Meta token with
 * `ads_management` and `business_management`; `calendar_connections` holds a
 * Google access/refresh pair. Both columns now go through `@/lib/crypto` on
 * read and write, and `decryptSecret` passes an unencrypted value straight
 * through, so the app keeps working on rows this script has not reached yet.
 * This converts the rows that predate that.
 *
 * Idempotent: a value already in the encrypted format is left alone, so a
 * re-run rewrites nothing.
 *
 * Dry run by default. Pass --yes to write. Needs TOKEN_ENCRYPTION_KEY, and it
 * must be the same key the app runs with, or every converted row becomes
 * unreadable.
 *
 *   pnpm --filter @floraclin/web tokens:encrypt
 *   pnpm --filter @floraclin/web tokens:encrypt -- --yes
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { calendarConnections, metaConnections } from '@/db/schema'
import { encryptIfPlaintext, isEncryptedSecret } from '@/lib/crypto'

const apply = process.argv.includes('--yes')

interface MetaRow {
  id: string
  tenantId: string
  accessToken: string
}

interface CalendarRow extends MetaRow {
  refreshToken: string
}

/**
 * Read both tables ONCE, so the report below is an accurate record of what the
 * transaction wrote even if a clinic reconnects while this runs.
 */
async function loadRows(): Promise<{ meta: MetaRow[]; calendar: CalendarRow[] }> {
  const [meta, calendar] = await Promise.all([
    db
      .select({
        id: metaConnections.id,
        tenantId: metaConnections.tenantId,
        accessToken: metaConnections.accessToken,
      })
      .from(metaConnections),
    db
      .select({
        id: calendarConnections.id,
        tenantId: calendarConnections.tenantId,
        accessToken: calendarConnections.accessToken,
        refreshToken: calendarConnections.refreshToken,
      })
      .from(calendarConnections),
  ])

  return { meta, calendar }
}

async function run(): Promise<number> {
  // Fails here rather than halfway through the transaction if the key is
  // missing or malformed.
  encryptIfPlaintext('preflight')

  const { meta, calendar } = await loadRows()

  const metaTodo = meta.filter((r) => !isEncryptedSecret(r.accessToken))
  const calendarTodo = calendar.filter(
    (r) => !isEncryptedSecret(r.accessToken) || !isEncryptedSecret(r.refreshToken),
  )

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}: encrypt stored OAuth tokens\n`)
  console.log(
    `meta_connections:     ${metaTodo.length} of ${meta.length} row(s) still plaintext`,
  )
  console.log(
    `calendar_connections: ${calendarTodo.length} of ${calendar.length} row(s) still plaintext\n`,
  )

  // Never the token itself, not even a prefix: this output ends up in a
  // terminal scrollback and, when run from CI, in a build log.
  for (const r of metaTodo) console.log(`  meta_connections      ${r.id}  (tenant ${r.tenantId})`)
  for (const r of calendarTodo) {
    console.log(`  calendar_connections  ${r.id}  (tenant ${r.tenantId})`)
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --yes to apply.\n')
    return 0
  }

  // One transaction. A half-applied run is still readable, because the
  // pass-through handles the rows it missed, but it leaves the operator with
  // no single answer to "is this table converted".
  await db.transaction(async (tx) => {
    for (const r of metaTodo) {
      await tx
        .update(metaConnections)
        .set({ accessToken: encryptIfPlaintext(r.accessToken) })
        .where(eq(metaConnections.id, r.id))
    }

    for (const r of calendarTodo) {
      await tx
        .update(calendarConnections)
        .set({
          accessToken: encryptIfPlaintext(r.accessToken),
          refreshToken: encryptIfPlaintext(r.refreshToken),
        })
        .where(eq(calendarConnections.id, r.id))
    }
  })

  console.log(`\nEncrypted ${metaTodo.length + calendarTodo.length} row(s).\n`)
  return 0
}

// Exit from the caller rather than mid-run, so stdout is fully flushed. This
// output is the only record of what the migration did.
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
