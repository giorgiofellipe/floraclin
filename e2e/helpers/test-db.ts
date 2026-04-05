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
 */
export async function setupTestDatabase() {
  const sql = getTestDb()

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS floraclin`

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

    // Add reversed_at columns if not exist (manual migration)
    try {
      await sql`ALTER TABLE floraclin.payment_records ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ`
      await sql`ALTER TABLE floraclin.payment_records ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES floraclin.users(id)`
      await sql`ALTER TABLE floraclin.payment_records ADD COLUMN IF NOT EXISTS reversal_reason TEXT`
    } catch { /* ignore */ }

    console.log(`✓ Applied ${files.length} migrations`)
  } finally {
    await sql.end()
  }
}

/**
 * Truncate all tables in the floraclin schema.
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
 * Seed the test database with all data needed for e2e tests.
 *
 * Creates:
 * - Test user (owner, not platform admin)
 * - Test tenant with onboarding completed
 * - User membership
 * - 2 patients
 * - 2 procedure types
 * - Financial settings
 * - 3 expense categories
 */
export async function seedTestDatabase() {
  const sql = getTestDb()

  try {
    // ── User ─────────────────────────────────────────────────────
    await sql`
      INSERT INTO floraclin.users (id, email, full_name, is_platform_admin)
      VALUES (${TEST_USER_ID}, 'test@floraclin.test', 'Usuário E2E', false)
      ON CONFLICT (id) DO NOTHING
    `

    // ── Tenant (onboarding completed) ────────────────────────────
    await sql`
      INSERT INTO floraclin.tenants (id, name, slug, settings)
      VALUES (
        ${TEST_TENANT_ID},
        'Clínica E2E',
        'clinica-e2e',
        '{"onboarding_completed": true}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `

    // ── Membership ───────────────────────────────────────────────
    await sql`
      INSERT INTO floraclin.tenant_users (tenant_id, user_id, role, is_active)
      VALUES (${TEST_TENANT_ID}, ${TEST_USER_ID}, 'owner', true)
      ON CONFLICT DO NOTHING
    `

    // ── Patients ─────────────────────────────────────────────────
    await sql`
      INSERT INTO floraclin.patients (id, tenant_id, full_name, phone, cpf, responsible_user_id)
      VALUES
        ('00000000-0000-4000-a000-000000000010', ${TEST_TENANT_ID}, 'Maria Silva', '11999990001', '123.456.789-00', ${TEST_USER_ID}),
        ('00000000-0000-4000-a000-000000000011', ${TEST_TENANT_ID}, 'João Santos', '11999990002', '987.654.321-00', ${TEST_USER_ID})
      ON CONFLICT (id) DO NOTHING
    `

    // ── Procedure types ──────────────────────────────────────────
    await sql`
      INSERT INTO floraclin.procedure_types (id, tenant_id, name, category, estimated_duration_min, is_active)
      VALUES
        ('00000000-0000-4000-a000-000000000020', ${TEST_TENANT_ID}, 'Botox', 'botox', 30, true),
        ('00000000-0000-4000-a000-000000000021', ${TEST_TENANT_ID}, 'Preenchimento', 'filler', 60, true)
      ON CONFLICT (id) DO NOTHING
    `

    // ── Financial settings ───────────────────────────────────────
    await sql`
      INSERT INTO floraclin.financial_settings (id, tenant_id, fine_type, fine_value, monthly_interest_percent, grace_period_days)
      VALUES (
        '00000000-0000-4000-a000-000000000030',
        ${TEST_TENANT_ID},
        'percentage', '2.00', '1.00', 0
      )
      ON CONFLICT (id) DO NOTHING
    `

    // ── Expense categories ───────────────────────────────────────
    await sql`
      INSERT INTO floraclin.expense_categories (id, tenant_id, name, icon, sort_order)
      VALUES
        ('00000000-0000-4000-a000-000000000040', ${TEST_TENANT_ID}, 'Aluguel', 'building', 1),
        ('00000000-0000-4000-a000-000000000041', ${TEST_TENANT_ID}, 'Material', 'package', 2),
        ('00000000-0000-4000-a000-000000000042', ${TEST_TENANT_ID}, 'Outros', 'more-horizontal', 3)
      ON CONFLICT (id) DO NOTHING
    `

    console.log('✓ Database seeded (user, tenant, patients, procedures, financial settings, expense categories)')
  } finally {
    await sql.end()
  }
}

/**
 * Seed for onboarding tests — tenant with onboarding NOT completed.
 */
export async function seedForOnboarding() {
  const sql = getTestDb()

  try {
    await sql`
      INSERT INTO floraclin.users (id, email, full_name, is_platform_admin)
      VALUES (${TEST_USER_ID}, 'test@floraclin.test', 'Usuário E2E', false)
      ON CONFLICT (id) DO UPDATE SET is_platform_admin = false
    `

    await sql`
      INSERT INTO floraclin.tenants (id, name, slug, settings)
      VALUES (${TEST_TENANT_ID}, 'Clínica E2E', 'clinica-e2e', '{}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET settings = '{}'::jsonb
    `

    await sql`
      INSERT INTO floraclin.tenant_users (tenant_id, user_id, role, is_active)
      VALUES (${TEST_TENANT_ID}, ${TEST_USER_ID}, 'owner', true)
      ON CONFLICT DO NOTHING
    `

    console.log('✓ Database seeded for onboarding (incomplete)')
  } finally {
    await sql.end()
  }
}

/**
 * Full setup: migrate + reset + seed. Call before running e2e tests.
 */
export async function prepareTestDatabase() {
  await setupTestDatabase()
  await resetTestDatabase()
  await seedTestDatabase()
}
