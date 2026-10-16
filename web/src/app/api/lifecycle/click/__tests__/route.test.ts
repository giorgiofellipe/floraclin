import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { findLifecycleSendForClickMock, recordLifecycleClickMock } = vi.hoisted(() => ({
  findLifecycleSendForClickMock: vi.fn(),
  recordLifecycleClickMock: vi.fn(),
}))

vi.mock('@/db/queries/lifecycle', () => ({
  findLifecycleSendForClick: findLifecycleSendForClickMock,
  recordLifecycleClick: recordLifecycleClickMock,
}))

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: vi.fn(),
}))

vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.floraclin.com.br' }))

import { GET } from '../route'

describe('GET /api/lifecycle/click', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findLifecycleSendForClickMock.mockResolvedValue({
      id: 'send-1',
      tenantId: 'tenant-1',
      messageKey: 'trial_welcome',
      channel: 'email',
    })
    recordLifecycleClickMock.mockResolvedValue(true)
  })

  it('records the click and redirects to an allowed destination', async () => {
    const destination = encodeURIComponent(
      'https://app.floraclin.com.br/dashboard?utm_source=lifecycle&utm_medium=email&utm_campaign=trial_welcome&lc=send-1',
    )
    const request = new NextRequest(
      `https://app.floraclin.com.br/api/lifecycle/click?lc=send-1&to=${destination}`,
      {
        headers: {
          'user-agent': 'vitest',
          'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        },
      },
    )

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://app.floraclin.com.br/dashboard?utm_source=lifecycle&utm_medium=email&utm_campaign=trial_welcome&lc=send-1',
    )
    expect(recordLifecycleClickMock).toHaveBeenCalledWith({
      sendId: 'send-1',
      destination:
        'https://app.floraclin.com.br/dashboard?utm_source=lifecycle&utm_medium=email&utm_campaign=trial_welcome&lc=send-1',
      userAgent: 'vitest',
      ipAddress: '203.0.113.10',
    })
  })

  it('resolves WhatsApp destinations from the lifecycle send message key', async () => {
    findLifecycleSendForClickMock.mockResolvedValue({
      id: 'send-1',
      tenantId: 'tenant-1',
      messageKey: 'trial_first_patient',
      channel: 'whatsapp',
    })
    const request = new NextRequest('https://app.floraclin.com.br/api/lifecycle/click?lc=send-1')

    const response = await GET(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://app.floraclin.com.br/pacientes?novo=1&utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=trial_first_patient&lc=send-1',
    )
    expect(recordLifecycleClickMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sendId: 'send-1',
        destination:
          'https://app.floraclin.com.br/pacientes?novo=1&utm_source=lifecycle&utm_medium=whatsapp&utm_campaign=trial_first_patient&lc=send-1',
      }),
    )
  })

  it('rejects unknown send ids', async () => {
    findLifecycleSendForClickMock.mockResolvedValue(null)
    const request = new NextRequest('https://app.floraclin.com.br/api/lifecycle/click?lc=missing')

    const response = await GET(request)

    expect(response.status).toBe(404)
    expect(recordLifecycleClickMock).not.toHaveBeenCalled()
  })

  it('rejects mismatched WhatsApp destination keys', async () => {
    findLifecycleSendForClickMock.mockResolvedValue({
      id: 'send-1',
      tenantId: 'tenant-1',
      messageKey: 'trial_welcome',
      channel: 'whatsapp',
    })
    const request = new NextRequest(
      'https://app.floraclin.com.br/api/lifecycle/click?d=trial_ending&lc=send-1',
    )

    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(recordLifecycleClickMock).not.toHaveBeenCalled()
  })

  it('rejects open redirects', async () => {
    const request = new NextRequest(
      `https://app.floraclin.com.br/api/lifecycle/click?lc=send-1&to=${encodeURIComponent('https://evil.example/')}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(recordLifecycleClickMock).not.toHaveBeenCalled()
  })
})
