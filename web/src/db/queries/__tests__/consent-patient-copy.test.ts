import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The signing link stays usable for an hour after the patient signs. The claim
 * is what stops it from re-sending, and from sending acceptances it never signed.
 */

const captured: { sql: string; params: unknown[] }[] = []
let responses: unknown[][][] = []

vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async (sql: string, params: unknown[]) => {
      captured.push({ sql, params })
      return { rows: responses.shift() ?? [] }
    }),
  }
})

import { claimPatientCopy } from '../consent-signing-tokens'

beforeEach(() => {
  captured.length = 0
  responses = []
})

describe('claimPatientCopy', () => {
  it('puts the token and the unsent condition in the claim WHERE', async () => {
    await claimPatientCopy('acc-1', 'token-1')

    const [{ sql, params }] = captured
    expect(sql).toMatch(/^update "floraclin"\."consent_acceptances" set "patient_copy_sent_at" = \$1/)
    expect(sql).toMatch(
      /where \(\("floraclin"\."consent_acceptances"\."id" = \$2 and "floraclin"\."consent_acceptances"\."signing_token_id" = \$3\) and "floraclin"\."consent_acceptances"\."patient_copy_sent_at" is null\)/,
    )
    expect(params.slice(1)).toEqual(['acc-1', 'token-1'])
  })

  it.each([
    ['the copy was already sent', [['tenant-1']], { tenantId: 'tenant-1', alreadySent: true }],
    ['the acceptance is not this token\'s', [], null],
  ])('reports %s when the claim is not taken', async (_, ownRows, expected) => {
    responses = [[], ownRows]

    await expect(claimPatientCopy('acc-1', 'token-1')).resolves.toEqual(expected)
    expect(captured[1].sql).toMatch(/"signing_token_id" = \$2/)
  })
})
