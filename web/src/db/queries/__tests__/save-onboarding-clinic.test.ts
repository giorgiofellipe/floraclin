import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setMock, updateMock } = vi.hoisted(() => {
  const setMock = vi.fn()
  const chain: Record<string, unknown> = {}
  chain.set = setMock.mockImplementation(() => chain)
  chain.where = vi.fn(() => chain)
  chain.returning = vi.fn(async () => [{ id: 'tenant-1' }])
  return { setMock, updateMock: vi.fn(() => chain) }
})

vi.mock('@/db/client', () => ({ db: { update: updateMock } }))

import { saveOnboardingClinic } from '../tenants'

const clinic = { slug: 'bella', name: 'Clínica Bella', phone: '(11) 98888-7777', email: '' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveOnboardingClinic', () => {
  // Like the old updateTenant: an address the request left out is not cleared.
  it('leaves the address alone when it is omitted', async () => {
    expect(await saveOnboardingClinic('tenant-1', clinic)).toBe(true)

    expect(setMock.mock.calls[0][0]).not.toHaveProperty('address')
  })

  it('clears an emptied address', async () => {
    await saveOnboardingClinic('tenant-1', { ...clinic, address: null })

    expect(setMock.mock.calls[0][0]).toHaveProperty('address', null)
  })
})
