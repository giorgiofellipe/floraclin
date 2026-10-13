import { describe, it, expect, vi, afterEach } from 'vitest'
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

const dbMock = { select: vi.fn() }
vi.mock('@/db/client', () => ({ db: dbMock }))

describe('listExpenses overdue filter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Postgres CURRENT_DATE on a UTC host is already May 23 at 22:00 BRT, which
  // would flag an expense installment due May 22 as overdue.
  it('compares due dates with the BR day, not the database clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T01:00:00.000Z'))
    const { listExpenses } = await import('../expenses')

    const countQuery: { where?: unknown } = {}
    dbMock.select.mockReturnValueOnce(chainCapturingWhere([{ count: 0 }], countQuery))
    dbMock.select.mockReturnValueOnce(chainCapturingWhere([], {}))

    await listExpenses('00000000-0000-0000-0000-00000000a001', { isOverdue: true } as never)

    const query = new PgDialect().sqlToQuery(countQuery.where as SQL)
    expect(query.sql).not.toContain('CURRENT_DATE')
    expect(query.params).toContain('2026-05-22')
  })
})
