import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureExceptionMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  withMonitor: (_slug: string, body: () => Promise<unknown>) => body(),
  flush: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/db/queries/lifecycle', () => ({
  findLifecycleRecipients: vi.fn(),
  getCompletedLifecycleKeys: vi.fn(),
}))

vi.mock('@/lib/activation', () => ({
  getActivationState: vi.fn(),
}))

vi.mock('@/lib/lifecycle-sender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lifecycle-sender')>()),
  deliverLifecycleMessage: vi.fn(),
}))

import { findLifecycleRecipients, getCompletedLifecycleKeys } from '@/db/queries/lifecycle'
import { getActivationState, type ActivationState } from '@/lib/activation'
import { deliverLifecycleMessage } from '@/lib/lifecycle-sender'
import { GET } from '../route'

const SECRET = 'test-secret'

const recipient = (tenantId: string) => ({
  tenantId,
  tenantName: `Clinic ${tenantId}`,
  tenantPhone: null,
  ownerName: 'Ana Souza',
  ownerEmail: `${tenantId}@example.com`,
})

const baseState: ActivationState = {
  onboardingDone: true,
  hasPatient: true,
  hasAppointment: true,
  hasProcedureRecord: true,
  hasWhatsappSend: true,
  trialDay: 1,
  daysLeft: 13,
  subscriptionStatus: 'trialing',
  subscriptionSource: 'trial',
  optedOut: false,
}

// trial_welcome and trial_setup_incomplete are both due; welcome has priority.
const twoDueState: ActivationState = { ...baseState, onboardingDone: false }

function request(auth?: string) {
  return new Request('http://localhost/api/cron/trial-lifecycle', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/cron/trial-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', SECRET)
    vi.stubEnv('LIFECYCLE_ENABLED', 'true')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(getCompletedLifecycleKeys).mockResolvedValue(new Set())
    vi.mocked(deliverLifecycleMessage).mockResolvedValue({ whatsapp: 'sent', email: 'sent' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([undefined, 'Bearer wrong'])(
    'rejects a missing or wrong bearer (%s) before touching any clinic data',
    async (auth) => {
      const res = await GET(request(auth))

      expect(res.status).toBe(401)
      expect(findLifecycleRecipients).not.toHaveBeenCalled()
    },
  )

  it('does nothing when LIFECYCLE_ENABLED is not true, so the kill switch really stops sends', async () => {
    vi.stubEnv('LIFECYCLE_ENABLED', '')

    const res = await GET(request(`Bearer ${SECRET}`))

    expect(await res.json()).toEqual({ ok: true, disabled: true })
    expect(findLifecycleRecipients).not.toHaveBeenCalled()
    expect(deliverLifecycleMessage).not.toHaveBeenCalled()
  })

  it('delivers only the first due message when a clinic has several, so owners do not get bursts', async () => {
    vi.mocked(findLifecycleRecipients).mockResolvedValue([recipient('t1')])
    vi.mocked(getActivationState).mockResolvedValue(twoDueState)

    await GET(request(`Bearer ${SECRET}`))

    expect(deliverLifecycleMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deliverLifecycleMessage).mock.calls[0][1].key).toBe('trial_welcome')
  })

  it('keeps going after one clinic throws and marks that clinic tenant_error', async () => {
    vi.mocked(findLifecycleRecipients).mockResolvedValue([recipient('bad'), recipient('good')])
    vi.mocked(getActivationState).mockResolvedValue(twoDueState)
    vi.mocked(deliverLifecycleMessage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ whatsapp: 'sent', email: 'sent' })

    const res = await GET(request(`Bearer ${SECRET}`))
    const body = await res.json()

    expect(body.outcomes).toEqual([
      { tenantId: 'bad', result: 'tenant_error' },
      { tenantId: 'good', result: 'delivered', key: 'trial_welcome', whatsapp: 'sent', email: 'sent' },
    ])
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
  })
})
