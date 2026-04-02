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
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 5, // recycle connections every 5 min to avoid stale sockets
})

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pgClient = client
}

export const db = drizzle(client, { schema })
