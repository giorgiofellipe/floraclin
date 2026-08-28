import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'

// listMarketingReportRows issues up to two select/from/[leftJoin]/where
// chains: one for prospects LEFT JOIN lead_attributions, and (only when at
// least one prospect converted) one for financial_entries. We drive a fake
// `db` that returns queued row arrays in call order; every chain method is a
// no-op that returns the same node.
const { queueRows, shiftRows, whereCalls, clearQueue } = vi.hoisted(() => {
  const queue: unknown[][] = []
  const whereCalls: unknown[] = []
  return {
    queueRows: (rows: unknown[]) => {
      queue.push(rows)
    },
    shiftRows: () => queue.shift() ?? [],
    whereCalls,
    clearQueue: () => {
      queue.length = 0
    },
  }
})

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => {
      const node: Record<string, unknown> = {}
      node.from = () => node
      node.leftJoin = () => node
      node.where = (...args: unknown[]) => {
        whereCalls.push(args)
        return node
      }
      node.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(shiftRows()).then(resolve, reject)
      return node
    }),
  },
}))

vi.mock('@/db/schema', () => ({
  prospects: {
    id: 'id',
    tenantId: 'tenant_id',
    stage: 'stage',
    source: 'source',
    convertedPatientId: 'converted_patient_id',
    createdAt: 'created_at',
  },
  leadAttributions: {
    prospectId: 'prospect_id',
    campaignId: 'campaign_id',
    adId: 'ad_id',
    channel: 'channel',
    adHeadline: 'ad_headline',
  },
  financialEntries: {
    tenantId: 'tenant_id',
    patientId: 'patient_id',
    totalAmount: 'total_amount',
    status: 'status',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ['and', ...args],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lte: (a: unknown, b: unknown) => ['lte', a, b],
  inArray: (a: unknown, b: unknown) => ['inArray', a, b],
}))

import { listMarketingReportRows } from '../marketing'

function leadRow(overrides: {
  stage?: string
  source?: string
  convertedPatientId?: string | null
  campaignId?: string | null
  adId?: string | null
  channel?: string | null
  adHeadline?: string | null
} = {}) {
  return {
    stage: 'novo',
    source: 'whatsapp',
    convertedPatientId: null,
    campaignId: null,
    adId: null,
    channel: null,
    adHeadline: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearQueue()
  whereCalls.length = 0
})

describe('listMarketingReportRows', () => {
  it('buckets two prospects from the same adId into one row', async () => {
    queueRows([
      leadRow({ adId: 'ad-1', channel: 'ctwa', stage: 'novo' }),
      leadRow({ adId: 'ad-1', channel: 'ctwa', stage: 'contatado', adHeadline: 'Promo Botox' }),
    ])

    const rows = await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(rows).toHaveLength(1)
    expect(rows[0].leads).toBe(2)
    expect(rows[0].contacted).toBe(1)
    // The bucket picks up the ad headline once one of its rows carries one.
    expect(rows[0].adLabel).toBe('Promo Botox')
  })

  it('sums revenue from the financial_entries rows the status filter returns, and requests only paid/partial', async () => {
    queueRows([leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' })])
    // Filtering by status happens in the DB (`inArray` in the where clause,
    // asserted below), so the fake db here only returns what a real
    // paid/partial-scoped query would: a pending entry never reaches this
    // function to sum.
    queueRows([
      { patientId: 'patient-1', totalAmount: '500.00', status: 'paid' },
      { patientId: 'patient-1', totalAmount: '100.00', status: 'partial' },
    ])

    const rows = await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(rows).toHaveLength(1)
    expect(rows[0].converted).toBe(1)
    expect(rows[0].revenue).toBe(600)

    expect(whereCalls).toHaveLength(2)
    const [revenueAndCall] = whereCalls[1] as [unknown[]]
    const [, ...revenueConditions] = revenueAndCall
    const statusCondition = revenueConditions.find(
      (c) => Array.isArray(c) && c[0] === 'inArray' && c[1] === 'status',
    ) as [string, string, string[]] | undefined
    expect(statusCondition?.[2]).toEqual(['paid', 'partial'])
  })

  it('does not query financial_entries when no prospect converted', async () => {
    queueRows([leadRow({ adId: 'ad-2' })])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    // Only the prospects/lead_attributions select ran a `where`.
    expect(whereCalls).toHaveLength(1)
  })

  it('appears under prospects.source when there is no attribution row', async () => {
    queueRows([leadRow({ source: 'instagram', campaignId: null, adId: null, channel: null })])

    const rows = await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('instagram')
    expect(rows[0].adLabel).toBe('instagram')
  })

  it('scopes the prospects query to the BR day boundary, including a lead created at 23:30 BRT on the last day', async () => {
    queueRows([leadRow()])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(whereCalls).toHaveLength(1)
    const [andCall] = whereCalls[0] as [unknown[]]
    const [, ...conditions] = andCall
    const gteCondition = conditions[1] as [string, unknown, Date]
    const lteCondition = conditions[2] as [string, unknown, Date]

    expect(gteCondition[0]).toBe('gte')
    expect(lteCondition[0]).toBe('lte')
    expect(gteCondition[2]).toEqual(startOfBrDay('2026-04-01'))
    expect(lteCondition[2]).toEqual(endOfBrDay('2026-04-30'))

    // 23:30 BRT on 2026-04-30 is 2026-05-01T02:30:00Z: still inside the
    // upper bound, which is what would silently drop the lead if the route
    // used a bare `new Date('2026-04-30')` (UTC midnight) instead.
    const lateLeadInstant = new Date('2026-05-01T02:30:00Z')
    expect(lateLeadInstant.getTime()).toBeLessThanOrEqual((lteCondition[2] as Date).getTime())
  })
})
