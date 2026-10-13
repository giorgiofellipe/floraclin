import { vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

export interface Capture {
  /** The payload of the last .set() or .values() call. */
  value?: unknown
  /** The condition passed to .where(). */
  where?: unknown
  /** Every builder call after the first, in order. */
  calls?: [string, unknown[]][]
}

/**
 * A chainable, awaitable stand-in for drizzle's query builders: every method
 * returns the same proxy, and awaiting it resolves to `result`. With a
 * capture, the builder calls are recorded on it.
 */
export function chain(result: unknown, capture?: Capture) {
  return lazyChain(() => result, capture)
}

/** Like chain(), with the result computed when the query is awaited. */
export function lazyChain(resolveResult: () => unknown, capture?: Capture) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(resolveResult()).then(resolve, reject)
        }
        if (prop === 'catch') {
          return (reject: (e: unknown) => unknown) => Promise.resolve(resolveResult()).catch(reject)
        }
        return (...args: unknown[]) => {
          if (capture) {
            capture.calls = [...(capture.calls ?? []), [prop, args]]
            if (prop === 'set' || prop === 'values') capture.value = args[0]
            if (prop === 'where') capture.where = args[0]
          }
          return proxy
        }
      },
    },
  )
  return proxy
}

export function chainCapturing(result: unknown, capture: Capture) {
  return chain(result, capture)
}

const offlineDb = drizzle.mock()

/** The table a captured chain read with .from(). */
export function fromTable(capture: Capture): unknown {
  return capture.calls?.find(([method]) => method === 'from')?.[1][0]
}

/** The SQL a captured `tx.select(fields)` chain would have sent. */
export function selectSql(fields: unknown, capture: Capture): string {
  let query: any = fields === undefined ? offlineDb.select() : offlineDb.select(fields as never)
  for (const [method, args] of capture.calls ?? []) query = query[method](...args)
  return query.toSQL().sql
}

/** The bound parameters of a captured `.where()` condition. */
export function whereParams(capture: Capture): unknown[] {
  return new PgDialect().sqlToQuery(capture.where as SQL).params
}

export interface LoggedQuery {
  op: 'select' | 'update' | 'insert' | 'delete'
  /** The selected fields of a select. */
  fields?: unknown
  capture: Capture
}

/** The table a logged query reads or writes. */
export function tableOf(query: LoggedQuery): unknown {
  return query.op === 'select' ? fromTable(query.capture) : query.capture.calls?.[0]?.[1][0]
}

/** Whether a logged select takes a row lock. */
export function isLock(query: LoggedQuery): boolean {
  return query.op === 'select' && (query.capture.calls ?? []).some(([method]) => method === 'for')
}

/**
 * A transaction whose queries resolve through `resolve`, called when each one
 * is awaited, so a test can answer by table instead of by call order. Every
 * query is logged in the order it was issued.
 */
export function routedTx(resolve: (query: LoggedQuery) => unknown) {
  const log: LoggedQuery[] = []
  const builder = (op: 'select' | 'update' | 'insert' | 'delete') =>
    vi.fn((arg?: unknown) => {
      const query: LoggedQuery = { op, capture: {} }
      if (op === 'select') query.fields = arg
      else query.capture.calls = [[op, [arg]]]
      log.push(query)
      return lazyChain(() => resolve(query), query.capture)
    })
  const tx = {
    select: builder('select'),
    update: builder('update'),
    insert: builder('insert'),
    delete: builder('delete'),
    transaction: vi.fn(async (cb: (savepoint: unknown) => unknown): Promise<unknown> => cb(tx)),
  }
  return { tx, log }
}
