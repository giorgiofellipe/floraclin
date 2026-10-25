import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The signing link stays usable for an hour after the patient signs. The claim
 * is what stops it from re-sending, and from sending acceptances it never signed.
 */

const captured: { sql: string; params: unknown[] }[] = []

vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params })
      return { rows: [] }
    }),
  }
})

import { claimPatientCopy } from '../consent-signing-tokens'

beforeEach(() => {
  captured.length = 0
})

describe('claimPatientCopy', () => {
  it('claims only an unsent copy of an acceptance signed with this token', async () => {
    await claimPatientCopy('acc-1', 'token-1')

    const [{ sql, params }] = captured
    expect(sql).toMatch(/^update "floraclin"\."consent_acceptances" set "patient_copy_sent_at" = \$1/)
    expect(sql).toMatch(
      /where \("floraclin"\."consent_acceptances"\."id" = \$2 and "floraclin"\."consent_acceptances"\."signing_token_id" = \$3 and "floraclin"\."consent_acceptances"\."patient_copy_sent_at" is null\)/,
    )
    expect(params.slice(1)).toEqual(['acc-1', 'token-1'])
  })

})
