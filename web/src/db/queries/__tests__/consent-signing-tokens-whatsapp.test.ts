import { describe, expect, it, vi } from 'vitest'

const { row } = vi.hoisted(() => ({ row: { current: null as Record<string, unknown> | null } }))

vi.mock('@/db/client', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row.current ? [row.current] : []),
  }
  return { db: chain }
})

import { getValidSigningToken } from '../consent-signing-tokens'

function tokenRow(tenantSettings: Record<string, unknown> | null) {
  return { id: 'tok-1', token: 'abc', tenantId: 'tenant-1', patientName: 'Maria', tenantSettings }
}

describe('getValidSigningToken whatsappEnabled for', () => {
  it.each([
    ['a shared-number clinic without the whatsapp_enabled flag', {}, true],
    ['an own-number clinic that has not enabled WhatsApp', { whatsapp_mode: 'own' }, false],
    ['an own-number clinic with WhatsApp enabled', { whatsapp_mode: 'own', whatsapp_enabled: true }, true],
  ])('%s', async (_case, settings, expected) => {
    row.current = tokenRow(settings)

    const result = await getValidSigningToken('abc')

    expect(result?.whatsappEnabled).toBe(expected)
  })
})
