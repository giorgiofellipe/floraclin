import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing a missing consent later must clear it from the pending list.
 */

let responses: unknown[][][] = []

vi.mock('@/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle(async () => ({ rows: responses.shift() ?? [] })),
  }
})

import { listPendingConsents } from '../consent'

beforeEach(() => {
  responses = []
})

// pg-proxy rows are positional arrays in select order.
const record = (id: string, required: string[]) => [id, 'Botox', null, required]

describe('listPendingConsents', () => {
  it('lists only the types not yet signed and drops fully signed records', async () => {
    responses = [
      [record('r-1', ['general', 'botox']), record('r-2', ['general'])],
      [['r-1', 'general'], ['r-2', 'general']],
    ]

    const items = await listPendingConsents('t-1', 'p-1')

    expect(items.map((i) => [i.procedureRecordId, i.pendingTypes])).toEqual([['r-1', ['botox']]])
  })

  it('returns nothing when no record has required consents', async () => {
    responses = [[]]

    await expect(listPendingConsents('t-1', 'p-1')).resolves.toEqual([])
  })
})
