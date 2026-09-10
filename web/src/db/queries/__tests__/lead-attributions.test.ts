import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same minimal thenable chain used by meta-connections.test.ts: every
// builder method returns the chain, and the chain resolves to `result`
// however long the call chain is.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const passthrough = ['from', 'where', 'limit', 'values', 'onConflictDoNothing', 'returning']
  for (const method of passthrough) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return chain
}

const { selectMock, insertMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
  },
}))

vi.mock('@/db/schema', () => ({
  leadAttributions: {
    tenantId: 'tenant_id',
    prospectId: 'prospect_id',
  },
}))

import { db } from '@/db/client'
import { getAttribution, recordAttribution } from '../lead-attributions'

const dbMock = db as unknown as {
  select: typeof selectMock
  insert: typeof insertMock
}

function makeAttributionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attr-1',
    tenantId: 'tenant-1',
    prospectId: 'prospect-1',
    channel: 'whatsapp',
    ctwaClid: 'AffQ123',
    fbclid: null,
    fbp: null,
    fbc: null,
    adId: '120210000000000',
    adsetId: null,
    campaignId: null,
    adHeadline: 'Botox promocional',
    sourceUrl: 'https://fb.me/abc',
    landingUrl: null,
    clientIp: null,
    userAgent: null,
    capturedAt: new Date('2026-08-01T12:00:00Z'),
    ...overrides,
  }
}

describe('lead-attributions queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAttribution', () => {
    it('returns the row for the given tenant and prospect', async () => {
      const row = makeAttributionRow()
      dbMock.select.mockReturnValue(makeChain([row]))

      const result = await getAttribution('tenant-1', 'prospect-1')

      expect(result).toEqual(row)
    })

    it('returns null when there is no attribution row', async () => {
      dbMock.select.mockReturnValue(makeChain([]))

      const result = await getAttribution('tenant-1', 'prospect-1')

      expect(result).toBeNull()
    })
  })

  describe('recordAttribution', () => {
    it('returns recorded:true when the insert lands a new row', async () => {
      const row = makeAttributionRow()
      dbMock.insert.mockReturnValue(makeChain([row]))

      const result = await recordAttribution({
        tenantId: 'tenant-1',
        prospectId: 'prospect-1',
        channel: 'whatsapp',
        ctwaClid: 'AffQ123',
      })

      expect(result).toEqual({ recorded: true })
    })

    it('uses onConflictDoNothing targeting prospectId, the first-touch rule', async () => {
      const chain = makeChain([makeAttributionRow()])
      dbMock.insert.mockReturnValue(chain)

      await recordAttribution({
        tenantId: 'tenant-1',
        prospectId: 'prospect-1',
        channel: 'whatsapp',
      })

      expect(chain.onConflictDoNothing).toHaveBeenCalledWith({ target: 'prospect_id' })
    })

    it('a second recordAttribution for the same prospect returns recorded:false', async () => {
      // First call: the unique index accepts the insert.
      dbMock.insert.mockReturnValueOnce(makeChain([makeAttributionRow()]))
      const first = await recordAttribution({
        tenantId: 'tenant-1',
        prospectId: 'prospect-1',
        channel: 'whatsapp',
        ctwaClid: 'first-touch',
      })
      expect(first).toEqual({ recorded: true })

      // Second call for the same prospectId: onConflictDoNothing skips the
      // insert, so returning() resolves empty.
      dbMock.insert.mockReturnValueOnce(makeChain([]))
      const second = await recordAttribution({
        tenantId: 'tenant-1',
        prospectId: 'prospect-1',
        channel: 'website',
        fbclid: 'second-touch',
      })
      expect(second).toEqual({ recorded: false })
    })
  })
})
