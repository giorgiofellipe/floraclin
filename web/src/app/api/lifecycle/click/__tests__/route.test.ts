import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { recordLifecycleClickMock } = vi.hoisted(() => ({
  recordLifecycleClickMock: vi.fn(),
}))

vi.mock('@/db/queries/lifecycle', () => ({
  recordLifecycleClick: recordLifecycleClickMock,
}))

vi.mock('@/lib/observability', () => ({
  reportSideEffectFailure: vi.fn(),
}))

import { GET } from '../route'

describe('GET /api/lifecycle/click', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('rejects open redirects', async () => {
    const request = new NextRequest(
      `https://app.floraclin.com.br/api/lifecycle/click?lc=send-1&to=${encodeURIComponent('https://evil.example/')}`,
    )

    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(recordLifecycleClickMock).not.toHaveBeenCalled()
  })
})
