/**
 * Playwright global setup — runs once before all tests.
 * Prepares the ephemeral Docker Postgres database.
 */
export default async function globalSetup() {
  // Dynamic import to avoid issues with test-db module
  const { prepareTestDatabase } = await import('./helpers/test-db')
  await prepareTestDatabase()
}
