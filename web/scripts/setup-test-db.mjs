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

async function run(statement, where) {
  try {
    await sql.unsafe(statement)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Supabase-only objects (auth schema, roles, policies) don't exist on plain Postgres.
    if (!message.includes('already exists') && !message.includes('duplicate key')) {
      console.warn(`${where}: ${message}`)
      return false
    }
    return true
  }
}

let failed = 0
try {
  await sql`CREATE SCHEMA IF NOT EXISTS floraclin`
  for (const file of files) {
    const statements = readFileSync(join(dir, file), 'utf-8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) {
      if (!(await run(statement, file))) failed += 1
    }
  }
  const columns = await columnStatements()
  for (const statement of columns) {
    if (!(await run(statement, 'schema.ts'))) failed += 1
  }
  console.log(`Applied ${files.length} migrations and ${columns.length} schema.ts statements (${failed} skipped)`)
} finally {
  await sql.end()
}
