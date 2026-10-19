import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Awaitable query-builder stand-in that keeps the condition passed to .where().
function chainCapturingWhere(result: unknown, capture: { where?: unknown }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
        }
        if (prop === 'where') {
          return (condition: unknown) => {
            capture.where = condition
            return proxy
          }
        }
        return () => proxy
      },
    },
  )
  return proxy
}

const dbMock = { select: vi.fn(), update: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

const TENANT = '00000000-0000-0000-0000-00000000a001'

function captured(builder: 'select' | 'update', result: unknown = []) {
  const capture: { where?: unknown } = {}
  dbMock[builder].mockReturnValueOnce(chainCapturingWhere(result, capture))
  return () => {
    const query = new PgDialect().sqlToQuery(capture.where as SQL)
    return { sql: query.sql, params: query.params }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// The claim is the only thing stopping two overlapping cron runs from sending
// the same message: without the IS NULL guard both UPDATEs return the row.
describe('automation claims', () => {
  it('claims a payment reminder only while its marker is unset, inside the tenant', async () => {
    const { claimPaymentReminder } = await import('../financial')
    const where = captured('update', [{ id: 'i1' }])

    await claimPaymentReminder(TENANT, 'i1')

    const { sql, params } = where()
    expect(sql).toContain('"installments"."reminder_sent_at" is null')
    expect(sql).toContain('"installments"."tenant_id" = $1')
    expect(params).toEqual([TENANT, 'i1'])
  })

  it('claims follow-up sessions only while their marker is unset, inside the tenant', async () => {
    const { claimFollowUp } = await import('../procedures')
    const where = captured('update', [{ id: 's1' }])

    await claimFollowUp(TENANT, ['s1', 's2'])

    const { sql, params } = where()
    expect(sql).toContain('"procedure_sessions"."follow_up_sent_at" is null')
    expect(sql).toContain('"procedure_sessions"."tenant_id" = $1')
    expect(params).toEqual([TENANT, 's1', 's2'])
  })
})

describe('due queries', () => {
  it('loads only pending, live, unreminded installments of the tenant', async () => {
    const { getInstallmentsDueReminder } = await import('../financial')
    const where = captured('select')

    await getInstallmentsDueReminder(TENANT, '2026-10-18', '2026-10-21')

    const { sql, params } = where()
    expect(sql).toContain('"installments"."tenant_id" = $1')
    expect(sql).toContain('"installments"."status" = $2')
    expect(params[1]).toBe('pending')
    for (const column of [
      '"installments"."cancelled_at"',
      '"installments"."reminder_sent_at"',
      '"financial_entries"."deleted_at"',
      '"patients"."deleted_at"',
    ]) {
      expect(sql).toContain(`${column} is null`)
    }
  })

  it('loads only unsent sessions of live records and patients of the tenant', async () => {
    const { getSessionsDueFollowUp } = await import('../procedures')
    const where = captured('select')

    await getSessionsDueFollowUp(TENANT, new Date('2026-10-11T03:00:00Z'), new Date('2026-10-14T02:59:59Z'))

    const { sql, params } = where()
    expect(sql).toContain('"procedure_sessions"."tenant_id" = $1')
    expect(params.slice(1, 3)).toEqual(['in_progress', 'completed'])
    for (const column of [
      '"procedure_records"."deleted_at"',
      '"procedure_sessions"."follow_up_sent_at"',
      '"patients"."deleted_at"',
    ]) {
      expect(sql).toContain(`${column} is null`)
    }
  })
})
