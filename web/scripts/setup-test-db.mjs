// Builds a disposable Postgres for the database tests in CI: every SQL
// migration (like e2e/helpers/test-db.ts does for the e2e suite), then any
// column of schema.ts the migrations never created. Some columns
// (users.password_hash, payment_records.reversed_at...) were only ever pushed,
// so the migrations alone don't build today's tables.
// Usage: DATABASE_URL=postgresql://test:test@localhost:5432/floraclin_test node scripts/setup-test-db.mjs
// Add --print to only list the column statements, without a database.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { is, SQL } from 'drizzle-orm'
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core'

const printOnly = process.argv.includes('--print')

/** ADD COLUMN IF NOT EXISTS for every column of schema.ts, without NOT NULL: the tests only need the column. */
async function columnStatements() {
  // Node strips the types; schema.ts only has type-only imports outside drizzle.
  const schema = await import('../src/db/schema.ts')
  const dialect = new PgDialect()
  const literal = (value) => {
    if (is(value, SQL)) return dialect.sqlToQuery(value).sql
    if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value !== null && typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`
    return null
  }
  const statements = []
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue
    const { name, schema: schemaName, columns } = getTableConfig(table)
    const qualified = `"${schemaName ?? 'public'}"."${name}"`
    statements.push(`CREATE TABLE IF NOT EXISTS ${qualified} ()`)
    for (const column of columns) {
      const fallback = column.default === undefined ? null : literal(column.default)
      statements.push(
        `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS "${column.name}" ${column.getSQLType()}` +
          (fallback ? ` DEFAULT ${fallback}` : ''),
      )
    }
  }
  return statements
}

if (printOnly) {
  for (const statement of await columnStatements()) console.log(statement)
  process.exit(0)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const { hostname } = new URL(url)
if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
  throw new Error(`Refusing to migrate ${hostname}: database tests only run against a local, disposable Postgres`)
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })
const dir = join(process.cwd(), 'src/db/migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

// Columns production got by push that a migration reads before any migration
// creates them: added right before that migration, with production's type.
const pushedBefore = {
  // Dropped again by 0008 itself, after copying it into prospect_procedure_types.
  '0008_prospect_value.sql': ['ALTER TABLE "floraclin"."prospects" ADD COLUMN IF NOT EXISTS "interested_procedures" jsonb'],
  '0023_email_confirmation.sql': ['ALTER TABLE "floraclin"."users" ADD COLUMN IF NOT EXISTS "email_verified" timestamptz'],
  '0034_installment_terms_snapshot.sql': [
    'ALTER TABLE "floraclin"."payment_records" ADD COLUMN IF NOT EXISTS "reversed_at" timestamptz',
  ],
}

// The only error a fresh database may give: an object a migration creates
// again (0000 creates the floraclin schema made above). Anything else stops
// the setup, so the tests never run on a half-built database.
const ALREADY_EXISTS = new Set(['42P06', '42P07', '42701', '42710'])

async function run(statement, where) {
  try {
    await sql.unsafe(statement)
  } catch (err) {
    if (ALREADY_EXISTS.has(err?.code)) return
    throw new Error(`${where}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

try {
  await sql`CREATE SCHEMA IF NOT EXISTS floraclin`
  for (const file of files) {
    for (const statement of pushedBefore[file] ?? []) await run(statement, `${file} (pushed column)`)
    const statements = readFileSync(join(dir, file), 'utf-8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) await run(statement, file)
  }
  const columns = await columnStatements()
  for (const statement of columns) await run(statement, 'schema.ts')
  console.log(`Applied ${files.length} migrations and ${columns.length} schema.ts statements`)
} finally {
  await sql.end()
}
