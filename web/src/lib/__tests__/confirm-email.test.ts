/**
 * Tests for email-confirmation tokens.
 *
 * Pins two things that are easy to get wrong because a near-identical
 * mechanism (password reset) already exists in the same table:
 * identifiers are namespaced so a reset never wipes out a pending
 * confirmation, and issuing is one upsert so a resend race sends once.
 * Consumption is covered against a real database in confirm-email-db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { deleteMock, whereMock, returningMock, insertMock, valuesMock, updateMock, setMock, updateWhereMock, onConflictMock, insertReturningMock } =
  vi.hoisted(() => {
    const returningMock = vi.fn()
    const whereMock = vi.fn(() => ({ returning: returningMock }))
    const deleteMock = vi.fn(() => ({ where: whereMock }))

    // issueConfirmationToken upserts now: values -> onConflictDoUpdate ->
    // returning. Returning a row means the write won; an empty array means
    // the cooldown in setWhere rejected it.
    const insertReturningMock = vi.fn().mockResolvedValue([{ identifier: 'confirm:x' }])
    const onConflictMock = vi.fn((_cfg: Record<string, unknown>) => ({ returning: insertReturningMock }))
    const valuesMock = vi.fn((_row: Record<string, unknown>) => ({ onConflictDoUpdate: onConflictMock }))
    const insertMock = vi.fn(() => ({ values: valuesMock }))

    const updateWhereMock = vi.fn().mockResolvedValue(undefined)
    const setMock = vi.fn((_patch: Record<string, unknown>) => ({ where: updateWhereMock }))
    const updateMock = vi.fn(() => ({ set: setMock }))

    return { deleteMock, whereMock, returningMock, insertMock, valuesMock, updateMock, setMock, updateWhereMock, onConflictMock, insertReturningMock }
  })

vi.mock('@/db/client', () => ({
  db: {
    delete: deleteMock,
    insert: insertMock,
    update: updateMock,
  },
}))

vi.mock('@/db/schema', () => ({
  verificationTokens: { identifier: 'identifier', token: 'token' },
  users: { email: 'email', emailVerified: 'email_verified' },
}))

import { CONFIRM_TOKEN_TTL_MS } from '../confirm-email-page-state'
import {
  confirmIdentifier,
  hashToken,
  issueConfirmationToken,
} from '../confirm-email'


beforeEach(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret'
  vi.clearAllMocks()
  // Restore the upsert chain; clearAllMocks wipes return values.
  valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictMock })
  onConflictMock.mockReturnValue({ returning: insertReturningMock })
  insertReturningMock.mockResolvedValue([{ identifier: 'confirm:x' }])
  updateWhereMock.mockResolvedValue(undefined)
})

describe('confirmIdentifier', () => {
  it('namespaces and lowercases the email', () => {
    expect(confirmIdentifier('Foo@Bar.com')).toBe('confirm:foo@bar.com')
  })

  it('never collides with the bare identifier a password reset uses', () => {
    expect(confirmIdentifier('foo@bar.com')).not.toBe('foo@bar.com')
  })
})

describe('hashToken', () => {
  it('is deterministic and produces a 64-char sha256 hex digest', () => {
    const hash = hashToken('some-raw-token')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('some-raw-token')).toBe(hash)
  })
})

describe('issueConfirmationToken', () => {
  it('stores only the hash, keyed by the namespaced identifier, and returns the raw token', async () => {
    const raw = await issueConfirmationToken('New@Patient.com')

    expect(raw).not.toBeNull()
    expect(valuesMock).toHaveBeenCalledTimes(1)
    const inserted = valuesMock.mock.calls[0][0]!

    expect(inserted.identifier).toBe('confirm:new@patient.com')
    expect(inserted.token).not.toBe(raw)
    expect(inserted.token).toBe(hashToken(raw!))
    expect(inserted.lastSentAt).toBeInstanceOf(Date)

    const ttl = (inserted.expires as Date).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(CONFIRM_TOKEN_TTL_MS - 5000)
    expect(ttl).toBeLessThanOrEqual(CONFIRM_TOKEN_TTL_MS)
  })

  it('upserts rather than deleting first, so a concurrent resend cannot slip through', async () => {
    // The delete-then-insert it replaced left a window where a second caller
    // saw no row, found nothing to throttle against, and sent a second email.
    await issueConfirmationToken('new@patient.com')

    expect(onConflictMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('applies the cooldown inside the same statement when one is given', async () => {
    await issueConfirmationToken('new@patient.com', 60_000)

    const conflict = onConflictMock.mock.calls[0][0]! as { setWhere?: unknown }
    expect(conflict.setWhere).toBeDefined()
  })

  it('returns null when the cooldown rejected the write', async () => {
    // No row back from the upsert means setWhere matched nothing, which is
    // how the caller learns it was throttled.
    insertReturningMock.mockResolvedValueOnce([])

    expect(await issueConfirmationToken('new@patient.com', 60_000)).toBeNull()
  })

  it('does not constrain the write when no cooldown is given', async () => {
    // Signup has nothing to throttle against on a brand new account.
    await issueConfirmationToken('new@patient.com')

    const conflict = onConflictMock.mock.calls[0][0]! as { setWhere?: unknown }
    expect(conflict.setWhere).toBeUndefined()
  })
})

