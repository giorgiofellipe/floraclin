import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { isUniqueViolation } from '@/lib/errors'
import { users } from '@/db/schema'

/**
 * One address, one account.
 *
 * Signup checked for a duplicate with a SELECT and then inserted, which two
 * concurrent requests can both pass. Nothing in the database stopped them:
 * `users.email` is `notNull` and nothing more, verified against production
 * (only `users_pkey` on `id`). Two rows for one address means two passwords
 * for it, a single confirmation click verifying both (confirmation matches on
 * email), and `authorize` answering with whichever `limit(1)` returns.
 *
 * The index is the fix; the SELECT stays because it gives the ordinary case a
 * clean message. This pins both halves, plus the error mapping between them,
 * because a unique violation that escapes as a 500 is a worse signup
 * experience than the race it replaced.
 */

const WEB_SRC = path.resolve(__dirname, '../..')
const MIGRATION = path.join(WEB_SRC, 'db/migrations/0024_users_email_unique.sql')
const SCHEMA = path.join(WEB_SRC, 'db/schema.ts')
const SIGNUP = path.join(WEB_SRC, 'actions/signup.ts')

const INDEX_NAME = 'uq_users_email_lower'

/** Source with comments removed, so an assertion cannot pass on prose. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('users.email is unique in the database, not just in the code', () => {
  it('the migration creates the index on lower(email)', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8')
    const ddl = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')

    expect(ddl).toMatch(/create\s+unique\s+index/i)
    expect(ddl).toContain(INDEX_NAME)
    // On lower(email), not the raw column: every write path lowercases today,
    // so a plain index would be equivalent right now and quietly stop being
    // so the first time one forgets.
    expect(ddl).toMatch(/lower\s*\(\s*email\s*\)/i)
  })

  it('the drizzle schema declares the same index', () => {
    // Drizzle does not apply migrations here (they are run by hand), so the
    // schema declaring it is what keeps a future generated migration from
    // proposing to drop it.
    expect(fs.readFileSync(SCHEMA, 'utf8')).toContain(INDEX_NAME)
  })

  it('signup maps the violation back to the field error', () => {
    // Comments stripped first. Both the index name and the message appear in
    // prose elsewhere in this file, so matching the raw text passed even with
    // the whole isUniqueViolation branch deleted.
    const src = codeOnly(fs.readFileSync(SIGNUP, 'utf8'))

    expect(src).toContain('isUniqueViolation(')
    expect(src).toContain(INDEX_NAME)
    // Not a bare 500. The racing request has to see the same message the
    // non-racing one sees.
    expect(src).toMatch(/Este e-mail já está cadastrado/)
  })
})

describe('isUniqueViolation against the error drizzle really throws', () => {
  /**
   * The reason this test builds a real query instead of a plain object:
   * drizzle does not rethrow the driver's error. It wraps it in a
   * `DrizzleQueryError` whose own `code` is undefined and puts the postgres
   * error on `cause`. A handler reading the top level compiles, typechecks,
   * passes every mocked test, and never once matches in production.
   */
  async function catchDrizzleError(driverError: object): Promise<unknown> {
    const db = drizzle(async () => {
      throw driverError
    })
    try {
      await db.insert(users).values({ id: 'x', fullName: 'a', email: 'a@b.com' } as never)
      throw new Error('the insert was supposed to reject')
    } catch (err) {
      return err
    }
  }

  function pgError(over: Record<string, unknown> = {}) {
    return Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: INDEX_NAME,
      ...over,
    })
  }

  it('sees through the wrapper drizzle puts around it', async () => {
    const err = await catchDrizzleError(pgError())

    expect((err as { code?: string }).code, 'the wrapper carries no code of its own').toBeUndefined()
    expect(isUniqueViolation(err, INDEX_NAME)).toBe(true)
  })

  it('still distinguishes which index was hit through the wrapper', async () => {
    const err = await catchDrizzleError(pgError({ constraint_name: 'uq_tenant_users_tenant_user' }))

    expect(isUniqueViolation(err, INDEX_NAME)).toBe(false)
    expect(isUniqueViolation(err)).toBe(true)
  })

  it('does not match an unrelated database error', async () => {
    const err = await catchDrizzleError(pgError({ code: '23503', constraint_name: undefined }))

    expect(isUniqueViolation(err)).toBe(false)
  })
})

describe('isUniqueViolation', () => {
  it('recognises a Postgres unique violation by its SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('ignores every other error', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })

  it('distinguishes which index was hit', () => {
    // A tenant_users collision inside the same transaction must not be
    // reported to the user as "this email is taken".
    const err = { code: '23505', constraint_name: 'uq_tenant_users_tenant_user' }

    expect(isUniqueViolation(err, INDEX_NAME)).toBe(false)
    expect(isUniqueViolation({ code: '23505', constraint_name: INDEX_NAME }, INDEX_NAME)).toBe(true)
  })
})
