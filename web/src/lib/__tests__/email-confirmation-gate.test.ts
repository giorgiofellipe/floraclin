// @vitest-environment node
/**
 * An owner who signed up with a password uses the app before confirming the
 * address, but nothing that reaches someone else on that address's word:
 * WhatsApp on the shared number, team invites, checkout. Each test here names
 * the hole it would catch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

const { ownerRow, captured } = vi.hoisted(() => ({
  ownerRow: { current: null as null | { emailVerified: Date | null; passwordHash: string | null } },
  captured: [] as string[],
}))

// Real SQL through pg-proxy: the gate's meaning is in the query.
vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string) => {
    captured.push(sql)
    const row = ownerRow.current
    return { rows: row ? [[row.emailVerified, row.passwordHash]] : [] }
  }),
}))

import {
  EmailConfirmationRequiredError,
  emailConfirmationGate,
  isTenantAwaitingEmailConfirmation,
  requireTenantEmailConfirmed,
} from '../email-confirmation-gate'
import { handleApiError } from '../api-error'

beforeEach(() => {
  captured.length = 0
  ownerRow.current = null
})

describe('emailConfirmationGate (the signed-in user)', () => {
  it('answers 403 email_unconfirmed for an unconfirmed user', async () => {
    const res = emailConfirmationGate({ emailVerified: false, isPlatformAdmin: false })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ code: 'email_unconfirmed' })
  })

  it('lets a confirmed user, a context that does not say, and a platform admin through', () => {
    expect(emailConfirmationGate({ emailVerified: true, isPlatformAdmin: false })).toBeNull()
    expect(emailConfirmationGate({ isPlatformAdmin: false })).toBeNull()
    expect(emailConfirmationGate({ emailVerified: false, isPlatformAdmin: true })).toBeNull()
  })
})

describe('isTenantAwaitingEmailConfirmation (the clinic, for sends without a user)', () => {
  it('is true for an owner with a password and no confirmation', async () => {
    ownerRow.current = { emailVerified: null, passwordHash: 'hash' }
    expect(await isTenantAwaitingEmailConfirmation('t1')).toBe(true)
    // The first active owner, as the lifecycle and reminder queries pick it.
    expect(captured[0]).toMatch(/"role" = \$\d/)
    expect(captured[0]).toMatch(/"is_active" = \$\d/)
    expect(captured[0]).toMatch(/order by "floraclin"\."tenant_users"\."created_at" asc/i)
  })

  it('is false once confirmed, and for owners who never had a password (Google, magic link, invited)', async () => {
    ownerRow.current = { emailVerified: new Date(), passwordHash: 'hash' }
    expect(await isTenantAwaitingEmailConfirmation('t1')).toBe(false)
    ownerRow.current = { emailVerified: null, passwordHash: null }
    expect(await isTenantAwaitingEmailConfirmation('t1')).toBe(false)
    ownerRow.current = null
    expect(await isTenantAwaitingEmailConfirmation('t1')).toBe(false)
  })

  it('throws the typed error the API maps to 403', async () => {
    ownerRow.current = { emailVerified: null, passwordHash: 'hash' }
    await expect(requireTenantEmailConfirmed('t1')).rejects.toBeInstanceOf(EmailConfirmationRequiredError)

    const res = handleApiError(new EmailConfirmationRequiredError())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'email_unconfirmed' })
  })
})
