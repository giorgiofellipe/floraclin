// Applies every migration to a disposable Postgres for the database tests in
// CI, the same way e2e/helpers/test-db.ts does for the e2e suite.
// Usage: DATABASE_URL=postgresql://test:test@localhost:5432/floraclin_test node scripts/setup-test-db.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const { hostname } = new URL(url)
if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
  throw new Error(`Refusing to migrate ${hostname}: database tests only run against a local, disposable Postgres`)
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })
const dir = join(process.cwd(), 'src/db/migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

let failed = 0
try {
  await sql`CREATE SCHEMA IF NOT EXISTS floraclin`
  for (const file of files) {
    const statements = readFileSync(join(dir, file), 'utf-8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) {
      try {
        await sql.unsafe(statement)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Supabase-only objects (auth schema, roles, policies) don't exist on plain Postgres.
        if (!message.includes('already exists') && !message.includes('duplicate key')) {
          failed += 1
          console.warn(`${file}: ${message}`)
        }
      }
    }
  }
  console.log(`Applied ${files.length} migrations (${failed} statements skipped)`)
} finally {
  await sql.end()
}
