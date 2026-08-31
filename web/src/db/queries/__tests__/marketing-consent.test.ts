import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same minimal thenable chain used by meta-connections.test.ts and
// lead-attributions.test.ts.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const passthrough = ['from', 'where', 'limit']
  for (const method of passthrough) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

/** Records every `where` predicate so a test can inspect what was matched on. */
function makeRecordingChain(result: unknown, whereArgs: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.where = vi.fn((...args: unknown[]) => {
    whereArgs.push(...args)
    return chain
  })
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

/** Walks a drizzle SQL fragment looking for a bound parameter value. */
function carriesValue(node: unknown, target: string, seen = new Set<unknown>()): boolean {
  if (node === target) return true
  if (typeof node !== 'object' || node === null || seen.has(node)) return false
  seen.add(node)
  return Object.values(node as Record<string, unknown>).some((child) =>
    carriesValue(child, target, seen),
  )
}

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: selectMock,
  },
}))

vi.mock('@/db/schema', () => ({
  prospects: {
    tenantId: 'tenant_id',
    id: 'id',
    marketingOptOut: 'marketing_opt_out',
  },
  patients: {
    tenantId: 'tenant_id',
    id: 'id',
    phone: 'phone',
    phoneSecondary: 'phone_secondary',
    deletedAt: 'deleted_at',
    marketingOptOut: 'marketing_opt_out',
  },
}))

import { db } from '@/db/client'
import { isMarketingOptedOut } from '../marketing-consent'

const dbMock = db as unknown as { select: typeof selectMock }

describe('isMarketingOptedOut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when the patient has not opted out', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: false }]))

    const result = await isMarketingOptedOut('tenant-1', { patientId: 'patient-1' })

    expect(result).toBe(false)
  })

  it('returns true when the patient flag is set', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', { patientId: 'patient-1' })

    expect(result).toBe(true)
  })

  it('returns false when neither a patient id nor a phone is supplied', async () => {
    const result = await isMarketingOptedOut('tenant-1', {})

    expect(result).toBe(false)
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('reads exactly one row when only a patient id is given', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', { patientId: 'patient-1' })

    expect(result).toBe(true)
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('treats a missing row as not opted out', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([]))

    const result = await isMarketingOptedOut('tenant-1', { patientId: 'patient-missing' })

    expect(result).toBe(false)
  })

  // The leak: a converted patient writing in from a brand new prospect has no
  // convertedPatientId, so the phone is the only link back to the flag.
  it('resolves the patient by phone when there is no patient id', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(result).toBe(true)
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('returns false when no patient matches the phone', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([]))

    const result = await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(result).toBe(false)
  })

  it('suppresses when any patient sharing the phone has opted out', async () => {
    dbMock.select.mockReturnValueOnce(
      makeChain([{ marketingOptOut: false }, { marketingOptOut: true }]),
    )

    const result = await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(result).toBe(true)
  })

  it('still checks the phone when the patient id resolves to a record that has not opted out', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: false }]))
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', {
      patientId: 'patient-1',
      phone: '5547988443635',
    })

    expect(result).toBe(true)
    expect(dbMock.select).toHaveBeenCalledTimes(2)
  })

  it('skips the phone read once the patient id already says opted out', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', {
      patientId: 'patient-1',
      phone: '5547988443635',
    })

    expect(result).toBe(true)
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  // patients.phone holds whatever the clinic typed, so the predicate has to
  // carry the 9-digit and 8-digit tails rather than the canonical string.
  it('matches on the phone tails, not on an equality against the canonical form', async () => {
    const whereArgs: unknown[] = []
    dbMock.select.mockReturnValueOnce(makeRecordingChain([], whereArgs))

    await isMarketingOptedOut('tenant-1', { phone: '+55 (47) 98844-3635' })

    expect(whereArgs.some((arg) => carriesValue(arg, '47988443635'))).toBe(true)
    expect(whereArgs.some((arg) => carriesValue(arg, '4788443635'))).toBe(true)
    expect(whereArgs.some((arg) => carriesValue(arg, '5547988443635'))).toBe(false)
  })

  // The leak this closes: an opted-out patient who books or writes in from the
  // number stored as phoneSecondary was never matched at all.
  it('suppresses a patient reached only by the secondary number', async () => {
    const whereArgs: unknown[] = []
    dbMock.select.mockReturnValueOnce(makeRecordingChain([{ marketingOptOut: true }], whereArgs))

    const result = await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(result).toBe(true)
    expect(whereArgs.some((arg) => carriesValue(arg, 'phone_secondary'))).toBe(true)
  })

  it('matches the secondary number on the same tails as the primary', async () => {
    const whereArgs: unknown[] = []
    dbMock.select.mockReturnValueOnce(makeRecordingChain([], whereArgs))

    await isMarketingOptedOut('tenant-1', { phone: '+55 (47) 98844-3635' })

    // Two columns, two tail variants each.
    const tailHits = whereArgs.filter((arg) => carriesValue(arg, '47988443635'))
    expect(tailHits.length).toBeGreaterThan(0)
    expect(whereArgs.some((arg) => carriesValue(arg, 'phone'))).toBe(true)
    expect(whereArgs.some((arg) => carriesValue(arg, 'phone_secondary'))).toBe(true)
  })

  it('suppresses when the primary holder has not opted out but the secondary match has', async () => {
    dbMock.select.mockReturnValueOnce(
      makeChain([{ marketingOptOut: false }, { marketingOptOut: true }]),
    )

    const result = await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(result).toBe(true)
  })

  it('scopes the phone lookup by tenant', async () => {
    const whereArgs: unknown[] = []
    dbMock.select.mockReturnValueOnce(makeRecordingChain([], whereArgs))

    await isMarketingOptedOut('tenant-1', { phone: '5547988443635' })

    expect(whereArgs.some((arg) => carriesValue(arg, 'tenant-1'))).toBe(true)
  })
})
