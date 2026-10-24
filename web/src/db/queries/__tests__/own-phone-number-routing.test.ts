import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

/**
 * Own-number webhooks used `settings->>'whatsapp_phone_number_id' = id LIMIT 1`
 * with no ordering, mode or deletion filter. A shared-number tenant could store
 * another clinic's id for free and might be the row Postgres returned, which
 * put that clinic's inbound patient messages in its inbox. Only own-mode, live
 * tenants hold an id, and two of them holding the same one is refused, never
 * resolved by row order.
 *
 * Real drizzle through pg-proxy: the defence is the emitted filter.
 */

const captured: string[] = []
let rows: unknown[][] = []

vi.mock('@/db/client', () => ({
  db: drizzle(async (sql: string) => {
    captured.push(sql)
    return { rows }
  }),
}))
vi.mock('@/lib/logo', () => ({ fetchLogoDataUri: vi.fn(), signLogoPath: vi.fn() }))

import { findTenantIdByOwnPhoneNumberId } from '../tenants'

beforeEach(() => {
  captured.length = 0
  rows = []
})

describe('findTenantIdByOwnPhoneNumberId', () => {
  it('counts only own-mode tenants that are not deleted', async () => {
    rows = [['tenant-a']]

    expect(await findTenantIdByOwnPhoneNumberId('111')).toBe('tenant-a')
    expect(captured[0]).toMatch(/->>'whatsapp_mode' = 'own'/)
    expect(captured[0]).toMatch(/"deleted_at" is null/)
  })

  it('refuses to pick when two tenants hold the same id', async () => {
    rows = [['tenant-a'], ['tenant-b']]

    expect(await findTenantIdByOwnPhoneNumberId('111')).toBeNull()
  })
})
