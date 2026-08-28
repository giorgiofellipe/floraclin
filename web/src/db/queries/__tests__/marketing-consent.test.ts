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

  it('returns false when neither id is opted out', async () => {
    dbMock.select
      .mockReturnValueOnce(makeChain([{ marketingOptOut: false }]))
      .mockReturnValueOnce(makeChain([{ marketingOptOut: false }]))

    const result = await isMarketingOptedOut('tenant-1', {
      prospectId: 'prospect-1',
      patientId: 'patient-1',
    })

    expect(result).toBe(false)
  })

  it('returns true when the prospect row has marketingOptOut set', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', { prospectId: 'prospect-1' })

    expect(result).toBe(true)
  })

  it('returns true when only the patient flag is set', async () => {
    // The lead's own prospect row was never opted out; the flag was set
    // later, directly on the converted patient record.
    dbMock.select
      .mockReturnValueOnce(makeChain([{ marketingOptOut: false }]))
      .mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', {
      prospectId: 'prospect-1',
      patientId: 'patient-1',
    })

    expect(result).toBe(true)
  })

  it('returns false when no ids are supplied', async () => {
    const result = await isMarketingOptedOut('tenant-1', {})

    expect(result).toBe(false)
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('checks only the patient row when prospectId is absent', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([{ marketingOptOut: true }]))

    const result = await isMarketingOptedOut('tenant-1', { patientId: 'patient-1' })

    expect(result).toBe(true)
    expect(dbMock.select).toHaveBeenCalledTimes(1)
  })

  it('treats a missing row as not opted out', async () => {
    dbMock.select.mockReturnValueOnce(makeChain([]))

    const result = await isMarketingOptedOut('tenant-1', { prospectId: 'prospect-missing' })

    expect(result).toBe(false)
  })
})
