import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requirePlatformAdmin: vi.fn(async () => ({ userId: 'admin-1', isPlatformAdmin: true })) }))
vi.mock('@/db/queries/admin-tenants', () => ({
  ADMIN_SLUG_TAKEN: 'booking_slug_taken',
  getTenantDetail: vi.fn(),
  updateTenantAdmin: vi.fn(),
}))
vi.mock('@/db/queries/lifecycle', () => ({ getLifecycleHistory: vi.fn() }))

import { updateTenantAdmin } from '@/db/queries/admin-tenants'
import { BusinessError } from '@/lib/errors'
import { PUT } from '../route'

const put = (body: unknown) =>
  PUT(new Request('http://localhost/api/admin/tenants/t1', { method: 'PUT', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PUT /api/admin/tenants/[id]', () => {
  it('changes the slug as the signed-in admin', async () => {
    vi.mocked(updateTenantAdmin).mockResolvedValue({ id: 't1', slug: 'nova' } as never)

    const res = await put({ slug: 'nova' })

    expect(res.status).toBe(200)
    expect(updateTenantAdmin).toHaveBeenCalledWith('t1', { slug: 'nova' }, 'admin-1')
  })

  // Catches a reserved or held link surfacing as a generic 500.
  it('answers 409 with the message when the slug is taken or reserved', async () => {
    vi.mocked(updateTenantAdmin).mockRejectedValue(new BusinessError('booking_slug_taken', 'Este link já está em uso. Escolha outro.'))

    const res = await put({ slug: 'studio-bia' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Este link já está em uso. Escolha outro.' })
  })
})
