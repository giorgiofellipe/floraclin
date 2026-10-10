import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const optOutTenantLifecycle = vi.fn()
const isValidLifecycleOptOut = vi.fn()

vi.mock('@/lib/lifecycle-opt-out', () => ({
  optOutTenantLifecycle: (...args: unknown[]) => optOutTenantLifecycle(...args),
  isValidLifecycleOptOut: (...args: unknown[]) => isValidLifecycleOptOut(...args),
}))

import { GET, POST } from '../route'

const TENANT = '11111111-1111-4111-8111-111111111111'

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/lifecycle/opt-out?t=${TENANT}&s=abc`)
}

function postRequest(s: string): NextRequest {
  return new NextRequest('http://localhost/api/lifecycle/opt-out', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t: TENANT, s }).toString(),
  })
}

describe('lifecycle opt-out route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isValidLifecycleOptOut.mockImplementation((_t: string, s: string) => s === 'abc')
    optOutTenantLifecycle.mockResolvedValue(true)
  })

  it('GET with a valid link renders the form and never writes (mail scanners follow GET)', async () => {
    const res = await GET(getRequest())
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('Deseja parar de receber dicas da FloraClin?')
    expect(html).toContain('method="post"')
    expect(html).toContain('Parar de receber')
    expect(optOutTenantLifecycle).not.toHaveBeenCalled()
  })

  it('POST with a valid link opts the clinic out', async () => {
    const res = await POST(postRequest('abc'))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Pronto. Você não receberá mais dicas da FloraClin.')
    expect(optOutTenantLifecycle).toHaveBeenCalledWith(TENANT)
  })

  it('POST with a tampered signature answers 400 and never opts out', async () => {
    const res = await POST(postRequest('tampered'))

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Link inválido.')
    expect(optOutTenantLifecycle).not.toHaveBeenCalled()
  })
})
