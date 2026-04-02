import postgres from 'postgres'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5433/floraclin_test'

export function getTestDb() {
  return postgres(TEST_DB_URL, { prepare: false, max: 3, connect_timeout: 10 })
}

/**
 * Run all migrations against the test database.
 * Creates the floraclin schema and all tables.
 */
export async function setupTestDatabase() {
  const sql = getTestDb()

  try {
    // Create schema if not exists
    await sql`CREATE SCHEMA IF NOT EXISTS floraclin`

    // Run migrations in order
    const migrationsDir = join(process.cwd(), 'src/db/migrations')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
      .sort()

    for (const file of files) {
      const filePath = join(migrationsDir, file)
      const migration = readFileSync(filePath, 'utf-8')
      // Split by statement-breakpoint and execute each
      const statements = migration
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt)
        } catch (err) {
          // Ignore "already exists" errors during re-runs
          const msg = err instanceof Error ? err.message : ''
          if (!msg.includes('already exists') && !msg.includes('duplicate key')) {
            console.error(`Migration error in ${file}:`, msg)
          }
        }
      }
    }

    console.log(`Applied ${files.length} migrations`)
  } finally {
    await sql.end()
  }
}

/**
 * Truncate all tables in the floraclin schema.
 * Preserves schema structure but removes all data.
 */
export async function resetTestDatabase() {
  const sql = getTestDb()

  try {
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'floraclin'
    `

    if (tables.length > 0) {
      const tableNames = tables.map((t) => `floraclin.${t.tablename}`).join(', ')
      await sql.unsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`)
    }
  } finally {
    await sql.end()
  }
}

/**
 * Seed the test database with essential data for e2e tests.
 */
export async function seedTestDatabase() {
  const sql = getTestDb()

  try {
    // Create test tenant
    await sql`
      INSERT INTO floraclin.tenants (id, name, slug, settings)
      VALUES (
        'e2e-tenant-0000-0000-000000000001',
        'Clínica E2E',
        'clinica-e2e',
        '{"onboarding_completed": true}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `

    // Create test user in Supabase auth (this needs to be done via Supabase API)
    // For e2e, we use the existing admin user from the real Supabase project
    // The test DB is only for data isolation, auth still goes through Supabase

    console.log('Test database seeded')
  } finally {
    await sql.end()
  }
}
