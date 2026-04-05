import { prepareTestDatabase } from './helpers/test-db'

/**
 * Playwright global setup — runs once before all tests.
 * Prepares the ephemeral Docker Postgres database with full seed data
 * (tenant with onboarding completed, patients, procedure types, etc.)
 */
export default async function globalSetup() {
  console.log('\n🔧 Preparing test database...')
  await prepareTestDatabase()
  console.log('✅ Test database ready\n')
}
