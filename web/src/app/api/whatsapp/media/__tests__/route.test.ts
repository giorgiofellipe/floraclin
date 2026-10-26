import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/storage', () => ({ getSignedUrl: vi.fn() }))

import { getAuthContext } from '@/lib/auth'
import { getSignedUrl } from '@/lib/storage'
import { GET } from '../route'

function get(path: string) {
  return GET(new Request(`http://localhost/api/whatsapp/media?path=${encodeURIComponent(path)}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContext).mockResolvedValue({
    tenantId: 'tenant-b',
    userId: 'user-1',
    role: 'owner',
    email: 'dona@clinica.com.br',
    fullName: 'Dona',
    isPlatformAdmin: false,
  })
  vi.mocked(getSignedUrl).mockImplementation(async (path: string) => `https://storage.example/sign/${path}`)
})

describe('GET /api/whatsapp/media', () => {
  it('signs a key under the caller tenant', async () => {
    const res = await get('tenant-b/patients/p1/termo.pdf')

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://storage.example/sign/tenant-b/patients/p1/termo.pdf')
  })

  it.each([
    ['another tenant', 'tenant-a/patients/p1/foto.jpg'],
    ['a dot segment back out of the tenant', 'tenant-b/../tenant-a/patients/p1/foto.jpg'],
    ['an encoded dot segment', 'tenant-b/%2e%2e/tenant-a/patients/p1/foto.jpg'],
    ['a backslash dot segment', 'tenant-b/..\\tenant-a/patients/p1/foto.jpg'],
  ])('refuses %s', async (_label, path) => {
    const res = await get(path)

    expect(res.status).toBe(404)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})
