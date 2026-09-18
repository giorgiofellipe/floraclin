import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards a coupling that no mocked test can see and that broke the entire
 * signup flow once already.
 *
 * The confirmation-token upsert targets a PARTIAL unique index. Postgres only
 * accepts a partial index as an ON CONFLICT arbiter when the clause repeats
 * the index predicate; otherwise it raises
 *
 *   42P10: there is no unique or exclusion constraint matching the
 *          ON CONFLICT specification
 *
 * Drizzle emits that predicate only when `targetWhere` is passed. Without it
 * every credentials signup and every resend throws. Signup swallows the error
 * and only logs, so the symptom is silent: no confirmation email is ever
 * sent, the account can never be confirmed, and `authorize` then refuses to
 * sign it in. A dead account, with nothing in the response to say why.
 *
 * Verified against a real Postgres 15 with exactly this DDL: the statement
 * fails without the predicate and succeeds with it.
 *
 * `confirm-email.test.ts` mocks `db.insert` down to `vi.fn()`s, so no SQL is
 * ever built there, let alone executed. This test reads the two files off
 * disk instead and asserts they still agree, because the failure mode is the
 * migration and the query drifting apart.
 */

const WEB_SRC = path.resolve(__dirname, '../..')
const MIGRATION = path.join(WEB_SRC, 'db/migrations/0023_email_confirmation.sql')
const QUERY = path.join(WEB_SRC, 'lib/confirm-email.ts')

/**
 * The predicate both sides must share. Matched loosely on purpose: the SQL
 * writes `identifier LIKE 'confirm:%'`, while the TypeScript interpolates the
 * column as `${verificationTokens.identifier} like 'confirm:%'`. Both must
 * mention the column and apply the same LIKE.
 */
const LIKE_CLAUSE = /like\s+'confirm:%'/i
const MENTIONS_IDENTIFIER = /identifier/i

/**
 * The migration is mostly comments explaining why the index is partial, and
 * those comments quote the predicate. Matching against the raw file therefore
 * passes on the prose alone: delete the WHERE from the DDL and the assertions
 * stay green. Strip the comments first so the test reads the statement.
 */
function ddlOnly(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

function createIndexStatement(sql: string): string {
  const stmt = ddlOnly(sql)
    .split(';')
    .find((s) => /create\s+unique\s+index/i.test(s))
  expect(stmt, 'the migration no longer creates a unique index').toBeDefined()
  return stmt!
}

describe('confirmation token upsert matches its partial index', () => {
  it('the migration creates the index as partial on that predicate', () => {
    const stmt = createIndexStatement(fs.readFileSync(MIGRATION, 'utf8'))

    expect(stmt).toMatch(LIKE_CLAUSE)
    expect(stmt).toMatch(MENTIONS_IDENTIFIER)
  })

  it('the upsert repeats the predicate via targetWhere', () => {
    const src = fs.readFileSync(QUERY, 'utf8')

    expect(
      src.includes('targetWhere:'),
      'issueConfirmationToken targets a partial unique index, so it must pass ' +
        'targetWhere. Without it Postgres raises 42P10 and every signup and ' +
        'resend throws, silently, because signup only logs the error.',
    ).toBe(true)

    // Not merely present: it has to be the same predicate as the index.
    // `targetWhere:` with the colon, so the explanatory comment above the
    // call (which names the option) is not mistaken for the call itself.
    const targetWhereLine = src
      .split('\n')
      .find((line) => line.includes('targetWhere:'))
    expect(targetWhereLine).toMatch(LIKE_CLAUSE)
    expect(targetWhereLine).toMatch(MENTIONS_IDENTIFIER)
  })

  it('would fail if the predicate were dropped from the DDL', () => {
    // The point of stripping comments: this file explains the predicate in
    // prose several times, and matching the raw text passes on that alone.
    const withoutPredicate = fs
      .readFileSync(MIGRATION, 'utf8')
      .replace(/WHERE identifier LIKE 'confirm:%'/i, '')

    expect(createIndexStatement(withoutPredicate)).not.toMatch(LIKE_CLAUSE)
  })

  it('the index is partial, not plain, so magic links keep working', () => {
    // NextAuth's Resend provider writes this same table keyed by the bare
    // address and may legitimately hold more than one row at a time. A
    // non-partial unique index on identifier would break it, which is why
    // the predicate exists at all and why both sides have to carry it.
    const stmt = createIndexStatement(fs.readFileSync(MIGRATION, 'utf8'))

    expect(stmt).toMatch(/where/i)
  })
})
