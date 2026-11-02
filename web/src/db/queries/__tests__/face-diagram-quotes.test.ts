import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { routedTx } from '@/tests/mocks/drizzle-tx'

const dbMock = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('@/db/client', () => ({ db: dbMock }))

import { claimQuoteWhatsapp } from '../face-diagram-quotes'

describe('claimQuoteWhatsapp', () => {
  // Regression: two rapid sends both reached the WhatsApp sender.
  it('claims only an unsent quote with no live claim, in one conditional update', async () => {
    const { tx, log } = routedTx(() => [])
    Object.assign(dbMock, tx)

    expect(await claimQuoteWhatsapp('t1', 'q1')).toBe(false)

    expect(log).toHaveLength(1)
    const { sql, params } = new PgDialect().sqlToQuery(log[0].capture.where as SQL)
    expect(params).toEqual(['t1', 'q1'])
    expect(sql).toContain('"whatsapp_status" is null')
    expect(sql).toContain(`"whatsapp_requested_at" is null or "floraclin"."face_diagram_quotes"."whatsapp_requested_at" < now() - interval '2 minutes'`)
  })
})
