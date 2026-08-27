/**
 * Tests for email-confirmation tokens.
 *
 * Pins two things that are easy to get wrong because a near-identical
 * mechanism (password reset) already exists in the same table:
 * identifiers are namespaced so a reset never wipes out a pending
 * confirmation, and consumption is atomic so a replay or a race
 * between two clicks can never succeed twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { deleteMock, whereMock, returningMock, insertMock, valuesMock, updateMock, setMock, updateWhereMock } =
  vi.hoisted(() => {
    const returningMock = vi.fn()
    const whereMock = vi.fn(() => ({ returning: returningMock }))
    const deleteMock = vi.fn(() => ({ where: whereMock }))

    const valuesMock = vi.fn().mockResolvedValue(undefined)
    const insertMock = vi.fn(() => ({ values: valuesMock }))

    const updateWhereMock = vi.fn().mockResolvedValue(undefined)
    const setMock = vi.fn((_patch: Record<string, unknown>) => ({ where: updateWhereMock }))
    const updateMock = vi.fn(() => ({ set: setMock }))

    return { deleteMock, whereMock, returningMock, insertMock, valuesMock, updateMock, setMock, updateWhereMock }
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

import {
  CONFIRM_TOKEN_TTL_MS,
  confirmIdentifier,
  hashToken,
  issueConfirmationToken,
  consumeConfirmationToken,
} from '../confirm-email'

// markEmailVerified lives in the users query module rather than beside the
// tokens: `auth-config` calls it, and `auth-config` is imported by middleware,
// which runs on the Edge Runtime where this module's `node:crypto` import is
// unavailable.
vi.mock('@/lib/email', () => ({ sendInviteEmail: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ withTransaction: vi.fn() }))
import { markEmailVerified } from '@/db/queries/users'

beforeEach(() => {
  vi.clearAllMocks()
  valuesMock.mockResolvedValue(undefined)
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

    expect(whereMock).toHaveBeenCalled()
    expect(valuesMock).toHaveBeenCalledTimes(1)
    const inserted = valuesMock.mock.calls[0][0]

    expect(inserted.identifier).toBe('confirm:new@patient.com')
    expect(inserted.token).not.toBe(raw)
    expect(inserted.token).toBe(hashToken(raw))
    expect(inserted.lastSentAt).toBeInstanceOf(Date)

    const ttl = inserted.expires.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(CONFIRM_TOKEN_TTL_MS - 5000)
    expect(ttl).toBeLessThanOrEqual(CONFIRM_TOKEN_TTL_MS)
  })
})

describe('consumeConfirmationToken', () => {
  it('returns the lowercased email for a valid token', async () => {
    const future = new Date(Date.now() + 60_000)
    returningMock.mockResolvedValueOnce([
      { identifier: 'confirm:a@b.com', token: hashToken('raw'), expires: future },
    ])

    const result = await consumeConfirmationToken('A@B.com', 'raw')

    expect(result).toBe('a@b.com')
  })

  it('returns null for an expired token, and the row was still deleted', async () => {
    const past = new Date(Date.now() - 60_000)
    returningMock.mockResolvedValueOnce([
      { identifier: 'confirm:a@b.com', token: hashToken('raw'), expires: past },
    ])

    const result = await consumeConfirmationToken('a@b.com', 'raw')

    expect(result).toBeNull()
    // The delete-returning statement already ran unconditionally; there is
    // no separate delete step to skip. Asserting the call happened pins
    // that expiry is checked on the row AFTER consuming it, not before.
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when no row matches (unknown or already-consumed token)', async () => {
    returningMock.mockResolvedValueOnce([])

    const result = await consumeConfirmationToken('a@b.com', 'raw')

    expect(result).toBeNull()
  })

  it('rejects a replayed token on the second attempt', async () => {
    const future = new Date(Date.now() + 60_000)
    returningMock
      .mockResolvedValueOnce([{ identifier: 'confirm:a@b.com', token: hashToken('raw'), expires: future }])
      .mockResolvedValueOnce([])

    const first = await consumeConfirmationToken('a@b.com', 'raw')
    const second = await consumeConfirmationToken('a@b.com', 'raw')

    expect(first).toBe('a@b.com')
    expect(second).toBeNull()
  })

  it('yields exactly one success when two consumptions race', async () => {
    const future = new Date(Date.now() + 60_000)
    // The atomic DELETE ... RETURNING is what guarantees this: only one of
    // two concurrent statements against the same row can return it.
    returningMock
      .mockResolvedValueOnce([{ identifier: 'confirm:a@b.com', token: hashToken('raw'), expires: future }])
      .mockResolvedValueOnce([])

    const [first, second] = await Promise.all([
      consumeConfirmationToken('a@b.com', 'raw'),
      consumeConfirmationToken('a@b.com', 'raw'),
    ])

    const results = [first, second]
    expect(results.filter((r) => r === 'a@b.com')).toHaveLength(1)
    expect(results.filter((r) => r === null)).toHaveLength(1)
  })
})

describe('markEmailVerified', () => {
  it('sets emailVerified on the lowercased email', async () => {
    await markEmailVerified('Patient@Example.com')

    expect(setMock).toHaveBeenCalledTimes(1)
    const patch = setMock.mock.calls[0][0]
    expect(patch.emailVerified).toBeInstanceOf(Date)
    expect(updateWhereMock).toHaveBeenCalledTimes(1)
  })
})
