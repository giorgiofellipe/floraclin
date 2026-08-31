import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startOfBrDay, endOfBrDay } from '@/lib/dates'

// listMarketingReportRows issues up to two select/from/[join]/where chains:
// one for prospects LEFT JOIN lead_attributions, and (only when at least one
// prospect converted) one for payment_records joined up to financial_entries.
// We drive a fake `db` that returns queued row arrays in call order; every
// chain method is a no-op that returns the same node.
const { queueRows, shiftRows, whereCalls, joinCalls, orderByCalls, clearQueue } = vi.hoisted(() => {
  const queue: unknown[][] = []
  const whereCalls: unknown[] = []
  const joinCalls: unknown[] = []
  const orderByCalls: unknown[] = []
  return {
    queueRows: (rows: unknown[]) => {
      queue.push(rows)
    },
    shiftRows: () => queue.shift() ?? [],
    whereCalls,
    joinCalls,
    orderByCalls,
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
      node.leftJoin = (...args: unknown[]) => {
        joinCalls.push(args)
        return node
      }
      node.innerJoin = (...args: unknown[]) => {
        joinCalls.push(args)
        return node
      }
      node.where = (...args: unknown[]) => {
        whereCalls.push(args)
        return node
      }
      node.orderBy = (...args: unknown[]) => {
        orderByCalls.push(args)
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
    deletedAt: 'deleted_at',
  },
  leadAttributions: {
    tenantId: 'attr_tenant_id',
    prospectId: 'prospect_id',
    campaignId: 'campaign_id',
    adId: 'ad_id',
    channel: 'channel',
    adHeadline: 'ad_headline',
  },
  financialEntries: {
    id: 'entry_id',
    tenantId: 'entry_tenant_id',
    patientId: 'patient_id',
    deletedAt: 'entry_deleted_at',
  },
  installments: {
    id: 'installment_id',
    tenantId: 'installment_tenant_id',
    financialEntryId: 'installment_financial_entry_id',
  },
  paymentRecords: {
    installmentId: 'payment_installment_id',
    principalCovered: 'principal_covered',
    paidAt: 'paid_at',
    reversedAt: 'reversed_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ['and', ...args],
  asc: (a: unknown) => ['asc', a],
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  gte: (a: unknown, b: unknown) => ['gte', a, b],
  lte: (a: unknown, b: unknown) => ['lte', a, b],
  inArray: (a: unknown, b: unknown) => ['inArray', a, b],
  isNull: (a: unknown) => ['isNull', a],
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

/** Flattens the conditions an `and(...)` call collected for one `where`. */
function conditionsOf(call: unknown): unknown[] {
  const [andCall] = call as [unknown[]]
  const [, ...conditions] = andCall
  return conditions
}

function findCondition(conditions: unknown[], op: string, column: string) {
  return conditions.find((c) => Array.isArray(c) && c[0] === op && c[1] === column) as
    | [string, string, unknown]
    | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  clearQueue()
  whereCalls.length = 0
  joinCalls.length = 0
  orderByCalls.length = 0
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

  it('joins lead_attributions on the tenant as well as the prospect', async () => {
    queueRows([leadRow({ adId: 'ad-1' })])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    const [, joinCondition] = joinCalls[0] as [unknown, unknown[]]
    const [, ...conditions] = joinCondition
    expect(conditions).toContainEqual(['eq', 'prospect_id', 'id'])
    expect(conditions).toContainEqual(['eq', 'attr_tenant_id', 'tenant_id'])
  })

  it('sums the payments the converted patient made', async () => {
    queueRows([leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' })])
    queueRows([
      { patientId: 'patient-1', amount: '500.00' },
      { patientId: 'patient-1', amount: '100.00' },
    ])

    const rows = await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(rows).toHaveLength(1)
    expect(rows[0].converted).toBe(1)
    expect(rows[0].revenue).toBe(600)
  })

  it('bounds revenue to the reported period and drops reversed payments', async () => {
    queueRows([leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' })])
    queueRows([{ patientId: 'patient-1', amount: '500.00' }])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(whereCalls).toHaveLength(2)
    const conditions = conditionsOf(whereCalls[1])

    expect(findCondition(conditions, 'gte', 'paid_at')?.[2]).toEqual(startOfBrDay('2026-04-01'))
    expect(findCondition(conditions, 'lte', 'paid_at')?.[2]).toEqual(endOfBrDay('2026-04-30'))
    expect(conditions).toContainEqual(['isNull', 'reversed_at'])
    expect(conditions).toContainEqual(['isNull', 'entry_deleted_at'])
    expect(findCondition(conditions, 'inArray', 'patient_id')?.[2]).toEqual(['patient-1'])
  })

  it('scopes the payments query to the tenant on installments as well as on financial_entries', async () => {
    queueRows([leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' })])
    queueRows([{ patientId: 'patient-1', amount: '500.00' }])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    const conditions = conditionsOf(whereCalls[1])
    expect(conditions).toContainEqual(['eq', 'entry_tenant_id', 'tenant-1'])
    expect(conditions).toContainEqual(['eq', 'installment_tenant_id', 'tenant-1'])
  })

  it('requires the installment and the financial entry to belong to the same tenant in the join', async () => {
    queueRows([leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' })])
    queueRows([{ patientId: 'patient-1', amount: '500.00' }])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    // joinCalls[0] is the lead_attributions left join, [1] the installments
    // inner join, [2] the financial_entries inner join.
    const [, entryJoinCondition] = joinCalls[2] as [unknown, unknown[]]
    const [, ...conditions] = entryJoinCondition
    expect(conditions).toContainEqual(['eq', 'entry_id', 'installment_financial_entry_id'])
    expect(conditions).toContainEqual(['eq', 'entry_tenant_id', 'installment_tenant_id'])
  })

  it('leaves soft-deleted prospects out of the funnel', async () => {
    queueRows([leadRow({ adId: 'ad-1' })])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(conditionsOf(whereCalls[0])).toContainEqual(['isNull', 'deleted_at'])
  })

  it('orders prospects so the same data always attributes revenue the same way', async () => {
    queueRows([leadRow({ adId: 'ad-1' })])

    await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(orderByCalls).toHaveLength(1)
    expect(orderByCalls[0]).toEqual([
      ['asc', 'created_at'],
      ['asc', 'id'],
    ])
  })

  it('counts a patient reachable from two converted prospects only once', async () => {
    // `uq_prospects_tenant_phone` excludes `convertido`, so the same patient
    // can be pointed at by two converted rows sitting in different campaigns.
    queueRows([
      leadRow({ campaignId: 'camp-1', stage: 'convertido', convertedPatientId: 'patient-1' }),
      leadRow({ campaignId: 'camp-2', stage: 'convertido', convertedPatientId: 'patient-1' }),
    ])
    queueRows([{ patientId: 'patient-1', amount: '500.00' }])

    const rows = await listMarketingReportRows('tenant-1', { dateFrom: '2026-04-01', dateTo: '2026-04-30' })

    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(500)
    // The rows arrive oldest first, so the oldest prospect's campaign keeps it.
    expect(rows.find((row) => row.key === 'camp-1')?.revenue).toBe(500)
    expect(rows.find((row) => row.key === 'camp-2')?.revenue).toBe(0)
    // The patient is asked for once, so the second prospect row cannot re-add it.
    const conditions = conditionsOf(whereCalls[1])
    expect(findCondition(conditions, 'inArray', 'patient_id')?.[2]).toEqual(['patient-1'])
  })

  it('does not query payments when no prospect converted', async () => {
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
    const conditions = conditionsOf(whereCalls[0])
    const gteCondition = findCondition(conditions, 'gte', 'created_at') as [string, unknown, Date]
    const lteCondition = findCondition(conditions, 'lte', 'created_at') as [string, unknown, Date]

    expect(gteCondition[2]).toEqual(startOfBrDay('2026-04-01'))
    expect(lteCondition[2]).toEqual(endOfBrDay('2026-04-30'))

    // 23:30 BRT on 2026-04-30 is 2026-05-01T02:30:00Z: still inside the
    // upper bound, which is what would silently drop the lead if the route
    // used a bare `new Date('2026-04-30')` (UTC midnight) instead.
    const lateLeadInstant = new Date('2026-05-01T02:30:00Z')
    expect(lateLeadInstant.getTime()).toBeLessThanOrEqual((lteCondition[2] as Date).getTime())
  })
})
