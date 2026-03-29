import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// Reuse connection across hot reloads in development
// Without this, each hot reload creates a new connection pool,
// exhausting Supabase's connection limit
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined
}

const client = globalForDb.pgClient ?? postgres(connectionString, {
  prepare: false,
  max: 3, // limit pool size for serverless/dev
  idle_timeout: 20,
  connect_timeout: 10,
})

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pgClient = client
}

export const db = drizzle(client, { schema })
