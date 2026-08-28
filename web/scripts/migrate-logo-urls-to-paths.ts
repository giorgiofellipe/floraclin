/**
 * Convert every stored `tenants.logo_url` from a full Supabase signed URL to
 * the bare storage path.
 *
 * The column used to hold a signed URL with a 1-year token baked in, minted
 * once at upload and never re-signed: one year after each clinic's upload the
 * logo silently disappeared from every PDF and print page, and the bearer
 * token was rendered into the public, unauthenticated booking page. The column
 * now holds `<tenantId>/branding/logo-<uuid>.<ext>` and every read boundary
 * signs it with a short TTL (`signLogoPath`, `@/lib/logo`).
 *
 * Dry run by default. Pass --yes to write. Exits non-zero when any row could
 * not be converted, because those rows still hold a URL the app no longer
 * knows how to sign, so their logo will not render.
 *
 *   pnpm --filter @floraclin/web logo:migrate-paths
 *   pnpm --filter @floraclin/web logo:migrate-paths -- --yes
 */
import { eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { parseLogoUrl } from '@/lib/logo-url-migration'

const apply = process.argv.includes('--yes')

interface Row {
  id: string
  name: string
  logoUrl: string
}

interface Change extends Row {
  to: string
}

interface Failure extends Row {
  reason: string
}

/**
 * Read ONCE. The converted set and the report below are derived from the same
 * snapshot, so the output is an accurate record of what the transaction wrote
 * even if a clinic uploads a new logo while this runs.
 */
async function loadRows(): Promise<Row[]> {
  const rows = await db
    .select({ id: tenants.id, name: tenants.name, logoUrl: tenants.logoUrl })
    .from(tenants)
    .where(isNotNull(tenants.logoUrl))

  return rows.filter((r): r is Row => r.logoUrl !== null)
}

async function run(): Promise<number> {
  const rows = await loadRows()

  const changes: Change[] = []
  const failures: Failure[] = []
  let alreadyPath = 0

  for (const row of rows) {
    const parsed = parseLogoUrl(row.logoUrl)
    if (parsed.kind === 'converted') changes.push({ ...row, to: parsed.path })
    else if (parsed.kind === 'already-path') alreadyPath += 1
    else failures.push({ ...row, reason: parsed.reason })
  }

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}: tenants.logo_url URL -> storage path\n`)
  console.log(`${rows.length} tenant(s) with a logo`)
  console.log(`${changes.length} row(s) to rewrite`)
  console.log(`${alreadyPath} row(s) already hold a path\n`)

  for (const c of changes) {
    console.log(`  ${c.name.padEnd(30)} ${c.logoUrl}`)
    console.log(`  ${''.padEnd(30)} -> ${c.to}  (id ${c.id})`)
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} row(s) LEFT ALONE, could not recover a storage path:`)
    for (const f of failures) {
      console.log(`  ${f.name.padEnd(30)} ${f.logoUrl}`)
      console.log(`  ${''.padEnd(30)} !! ${f.reason}  (id ${f.id})`)
    }
    console.log('  Fix these by hand, or have the clinic re-upload its logo.')
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --yes to apply.\n')
    return failures.length > 0 ? 1 : 0
  }

  // One transaction. A half-applied run leaves the column holding a mix of
  // paths and URLs, which is exactly the state the app can no longer render.
  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx.update(tenants).set({ logoUrl: c.to }).where(eq(tenants.id, c.id))
    }
  })

  console.log(`\nRewrote ${changes.length} row(s).`)
  if (failures.length > 0) {
    console.log(`${failures.length} row(s) still hold a URL and will render no logo.`)
  }
  console.log('')
  return failures.length > 0 ? 1 : 0
}

// Exit from the caller rather than mid-run, so stdout is fully flushed. This
// output is the only record of what the migration did.
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
