import postgres from 'postgres'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5433/floraclin_test'
const TEST_USER_ID = process.env.TEST_USER_ID ?? '00000000-0000-4000-a000-000000000001'
const TEST_TENANT_ID = '00000000-0000-4000-a000-000000000002'

// Safety: refuse to connect to anything that looks like Supabase
if (TEST_DB_URL.includes('supabase.co') || TEST_DB_URL.includes('supabase.com')) {
  throw new Error(
    '🚫 REFUSING to connect to Supabase for e2e tests. ' +
    'Use a local Docker Postgres: pnpm test:db:up'
  )
}

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
      const statements = migration
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt)
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          if (!msg.includes('already exists') && !msg.includes('duplicate key')) {
            console.error(`Migration error in ${file}:`, msg)
          }
        }
      }
    }

    console.log(`✓ Applied ${files.length} migrations`)
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
    console.log('✓ Database reset')
  } finally {
    await sql.end()
  }
}

/**
 * Seed the test database with a test tenant, user, and membership.
 * This creates the minimal data needed for e2e tests to run.
 *
 * Auth is bypassed via TEST_AUTH_BYPASS_ENABLED — no real Supabase user needed.
 * The TEST_USER_ID env var is used as the user's UUID.
 */
export async function seedTestDatabase() {
  const sql = getTestDb()

  try {
    // Test user (no Supabase auth needed — auth bypass uses TEST_USER_ID)
    // Test user — NOT a platform admin (so onboarding redirect works)
    await sql`
      INSERT INTO floraclin.users (id, email, full_name, is_platform_admin)
      VALUES (${TEST_USER_ID}, 'test@floraclin.test', 'Usuário E2E', false)
      ON CONFLICT (id) DO NOTHING
    `

    // Tenant with onboarding NOT completed (for onboarding tests)
    await sql`
      INSERT INTO floraclin.tenants (id, name, slug, settings)
      VALUES (${TEST_TENANT_ID}, 'Clínica E2E', 'clinica-e2e', '{}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `

    // Membership: test user is owner of test tenant
    await sql`
      INSERT INTO floraclin.tenant_users (tenant_id, user_id, role, is_active)
      VALUES (${TEST_TENANT_ID}, ${TEST_USER_ID}, 'owner', true)
      ON CONFLICT DO NOTHING
    `

    console.log('✓ Database seeded (user + tenant + membership)')
  } finally {
    await sql.end()
  }
}

/**
 * Full setup: reset + migrate + seed. Call before running e2e tests.
 */
export async function prepareTestDatabase() {
  await setupTestDatabase()
  await resetTestDatabase()
  await seedTestDatabase()
}
