import { vi } from 'vitest'

/** Thenable query builder: every method returns the chain; awaiting it yields `result`. */
export function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'insert', 'values', 'returning', 'update', 'set', 'delete']) {
    c[m] = vi.fn(() => c)
  }
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}
