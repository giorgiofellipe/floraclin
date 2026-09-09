import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { users } from '@/db/schema'

/**
 * The first Google sign-in for a new person could not create their user.
 *
 * Auth.js hands the adapter `{ name, image }`. This schema calls those columns
 * `full_name` and `avatar_url`, and the `as any` casts on the adapter config
 * only silenced the types: drizzle drops keys it does not recognise and emits
 * DEFAULT for `full_name`, which is NOT NULL with no default in production.
 * Every brand-new Google signup died on a not-null violation, and the existing
 * "brand-new Google user" test passed because it mocked the adapter and called
 * the jwt callback with a user that already existed.
 *
 * This test drives real drizzle through pg-proxy and reads the SQL, because
 * the bug lived precisely in the gap between the types and the emitted query.
 */

const captured: { sql: string; params: unknown[] }[] = []

vi.mock('@/db/client', async () => ({
  db: drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params })
    return {
      rows: [
        [
          'user-1',
          'ana@clinica.com.br',
          'Dra Ana Souza',
          null,
          'https://img.example/a.png',
          null,
          null,
          false,
          null,
          null,
          null,
          null,
          null,
          null,
          new Date(),
          new Date(),
          null,
        ],
      ],
    }
  }),
}))

// Auth.js reaches the network at import time otherwise.
vi.mock('next-auth', () => ({ default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }) }))
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/google', () => ({ default: () => ({}) }))
vi.mock('next-auth/providers/resend', () => ({ default: () => ({}) }))

beforeEach(() => {
  captured.length = 0
})

/**
 * Runs the adapter's createUser and returns the column-to-value map drizzle
 * actually emitted. Column names are read off the statement and lined up with
 * the values list, so a column filled with DEFAULT reads as the literal
 * 'default' rather than quietly looking like a bound value.
 */
async function createUserColumns(data: Record<string, unknown>) {
  const { adapter } = await import('../auth-config')
  await adapter.createUser!(data as never)

  const insert = captured.find((c) => c.sql.startsWith('insert into'))
  expect(insert, 'no insert was emitted').toBeDefined()

  const columns = insert!.sql.match(/\(([^)]*)\) values/)![1].split(', ').map((c) => c.replace(/"/g, ''))
  const slots = insert!.sql.match(/values \(([^)]*)\)/)![1].split(', ')

  return Object.fromEntries(
    columns.map((column, i) => {
      const slot = slots[i]
      const param = slot.startsWith('$') ? insert!.params[Number(slot.slice(1)) - 1] : slot
      return [column, param]
    }),
  ) as Record<string, unknown>
}

describe('the OAuth adapter can actually create a user', () => {
  it('writes full_name rather than leaving it to a default that does not exist', async () => {
    const columns = await createUserColumns({
      id: 'user-1',
      name: 'Dra Ana Souza',
      email: 'ana@clinica.com.br',
      emailVerified: null,
      image: 'https://img.example/a.png',
    })

    // Before the fix this slot was the literal `default`, and Postgres
    // rejected the row because full_name is NOT NULL with no default.
    expect(columns.full_name).toBe('Dra Ana Souza')
  })

  it('maps image onto avatar_url', async () => {
    const columns = await createUserColumns({
      id: 'user-1',
      name: 'Dra Ana Souza',
      email: 'ana@clinica.com.br',
      emailVerified: null,
      image: 'https://img.example/a.png',
    })

    expect(columns.avatar_url).toBe('https://img.example/a.png')
  })

  it('normalises the address, because uq_users_email_lower is case-insensitive', async () => {
    const columns = await createUserColumns({
      id: 'user-1',
      name: 'Dra Ana Souza',
      email: 'Ana@Clinica.com.BR',
      emailVerified: null,
      image: null,
    })

    expect(columns.email).toBe('ana@clinica.com.br')
  })

  it('falls back to the local part rather than failing on a missing name', async () => {
    const columns = await createUserColumns({
      id: 'user-1',
      name: null,
      email: 'ana@clinica.com.br',
      emailVerified: null,
      image: null,
    })

    expect(columns.full_name).toBe('ana')
  })
})
