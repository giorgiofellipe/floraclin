import { beforeEach, describe, expect, it, vi } from 'vitest'

const pending: Promise<unknown>[] = []

vi.mock('next/server', () => ({
  after: vi.fn((task: () => Promise<unknown>) => {
    pending.push(task())
  }),
}))

vi.mock('@/db/queries/lifecycle', () => ({
  claimLifecycleSend: vi.fn(),
  finishLifecycleSend: vi.fn(),
  isTenantLifecycleOptedOut: vi.fn(),
  recordSkippedLifecycleSend: vi.fn(),
  findLifecycleRecipients: vi.fn(),
}))
vi.mock('@/lib/platform-whatsapp', () => ({ sendPlatformTemplate: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendLifecycleEmail: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
import { reportSideEffectFailure } from '@/lib/observability'
vi.mock('@/lib/activation', () => ({ getActivationState: vi.fn() }))
vi.mock('@/lib/lifecycle-opt-out', () => ({
  lifecycleOptOutUrl: vi.fn((tenantId: string) => `https://opt-out.test/${tenantId}`),
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))

import {
  claimLifecycleSend,
  finishLifecycleSend,
  findLifecycleRecipients,
  isTenantLifecycleOptedOut,
  recordSkippedLifecycleSend,
} from '@/db/queries/lifecycle'
import { sendPlatformTemplate } from '@/lib/platform-whatsapp'
import { sendLifecycleEmail } from '@/lib/email'
import { getActivationState } from '@/lib/activation'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import { deliverLifecycleMessage, scheduleLifecycleWelcome } from '../lifecycle-sender'

const recipient = {
  tenantId: 'tenant-1',
  tenantName: 'Clinica Flora',
  tenantPhone: '(11) 98765-4321',
  ownerName: 'Maria Souza',
  ownerEmail: 'maria@example.com',
}

const marketing = LIFECYCLE_MESSAGES.find((m) => m.category === 'MARKETING')!
const utility = LIFECYCLE_MESSAGES.find((m) => m.category === 'UTILITY')!

beforeEach(() => {
  vi.resetAllMocks()
  pending.length = 0
  vi.unstubAllEnvs()
  vi.mocked(claimLifecycleSend).mockImplementation(async ({ channel }) => `row-${channel}`)
  vi.mocked(sendPlatformTemplate).mockResolvedValue({ metaMessageId: 'wamid.1' })
  vi.mocked(sendLifecycleEmail).mockResolvedValue({ id: 'email-1' })
})

describe('deliverLifecycleMessage', () => {
  it('still sends the email when the WhatsApp send throws, and records the failure', async () => {
    vi.mocked(sendPlatformTemplate).mockRejectedValue(new Error('Meta API error: boom'))

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'failed', email: 'sent' })
    expect(sendLifecycleEmail).toHaveBeenCalledTimes(1)
    expect(finishLifecycleSend).toHaveBeenCalledWith('row-whatsapp', {
      status: 'failed',
      error: 'Meta API error: boom',
    })
  })

  it('skips a MARKETING message without claiming when the owner opted out after the cron read its state', async () => {
    vi.mocked(isTenantLifecycleOptedOut).mockResolvedValue(true)

    const outcome = await deliverLifecycleMessage(recipient, marketing)

    expect(outcome).toEqual({ whatsapp: 'skipped', email: 'skipped' })
    expect(claimLifecycleSend).not.toHaveBeenCalled()
    expect(recordSkippedLifecycleSend).not.toHaveBeenCalled()
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
    expect(sendLifecycleEmail).not.toHaveBeenCalled()
  })

  it('still sends a UTILITY message to an opted-out owner', async () => {
    vi.mocked(isTenantLifecycleOptedOut).mockResolvedValue(true)

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'sent', email: 'sent' })
  })

  it('still sends the email and reports both errors when recording the WhatsApp failure also throws', async () => {
    vi.mocked(sendPlatformTemplate).mockRejectedValue(new Error('Meta API error: boom'))
    vi.mocked(finishLifecycleSend).mockRejectedValueOnce(new Error('db down'))

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'failed', email: 'sent' })
    expect(reportSideEffectFailure).toHaveBeenCalledTimes(2)
  })

  it('sends nothing when both channels are already claimed', async () => {
    vi.mocked(claimLifecycleSend).mockResolvedValue(null)

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'already_claimed', email: 'already_claimed' })
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
    expect(sendLifecycleEmail).not.toHaveBeenCalled()
  })

  it('records a skipped WhatsApp row for an invalid phone and still sends the email', async () => {
    const outcome = await deliverLifecycleMessage({ ...recipient, tenantPhone: '(11) 1234' }, utility)

    expect(outcome).toEqual({ whatsapp: 'skipped', email: 'sent' })
    expect(recordSkippedLifecycleSend).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageKey: utility.key,
      channel: 'whatsapp',
      recipient: '111234',
      reason: 'invalid_phone',
    })
    expect(claimLifecycleSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' }),
    )
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
  })

  it('sends the WhatsApp template to the normalized phone with the first name', async () => {
    await deliverLifecycleMessage(recipient, utility)

    expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', utility.templateName, ['Maria'])
    expect(finishLifecycleSend).toHaveBeenCalledWith('row-whatsapp', {
      status: 'sent',
      metaMessageId: 'wamid.1',
    })
  })

  it('passes an opt-out URL for MARKETING emails and null for UTILITY', async () => {
    await deliverLifecycleMessage(recipient, marketing)
    await deliverLifecycleMessage(recipient, utility)

    const [marketingCall, utilityCall] = vi.mocked(sendLifecycleEmail).mock.calls
    expect(marketingCall[0].optOutUrl).toBe('https://opt-out.test/tenant-1')
    expect(utilityCall[0].optOutUrl).toBeNull()
  })

  it('builds the email button URL from the app URL and the button path', async () => {
    const withButton = LIFECYCLE_MESSAGES.find((m) => m.button)!

    await deliverLifecycleMessage(recipient, withButton)

    expect(vi.mocked(sendLifecycleEmail).mock.calls[0][0].button).toEqual({
      label: withButton.button!.label,
      url: `https://app.test${withButton.button!.path}`,
    })
  })
})

describe('scheduleLifecycleWelcome', () => {
  const dueState = { subscriptionStatus: 'trialing', trialDay: 0 } as never

  it('never queries recipients when LIFECYCLE_ENABLED is unset', async () => {
    scheduleLifecycleWelcome({ tenantId: 'tenant-1' })
    await Promise.all(pending)

    expect(findLifecycleRecipients).not.toHaveBeenCalled()
    expect(sendLifecycleEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when one email maps to two clinics', async () => {
    vi.stubEnv('LIFECYCLE_ENABLED', 'true')
    vi.mocked(findLifecycleRecipients).mockResolvedValue([
      recipient,
      { ...recipient, tenantId: 'tenant-2' },
    ])

    scheduleLifecycleWelcome({ ownerEmail: 'maria@example.com' })
    await Promise.all(pending)

    expect(findLifecycleRecipients).toHaveBeenCalledWith({ ownerEmail: 'maria@example.com' })
    expect(getActivationState).not.toHaveBeenCalled()
    expect(sendLifecycleEmail).not.toHaveBeenCalled()
  })

  it('delivers the welcome to a single eligible clinic', async () => {
    vi.stubEnv('LIFECYCLE_ENABLED', 'true')
    vi.mocked(findLifecycleRecipients).mockResolvedValue([recipient])
    vi.mocked(getActivationState).mockResolvedValue(dueState)

    scheduleLifecycleWelcome({ tenantId: 'tenant-1' })
    await Promise.all(pending)

    expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', 'trial_welcome', ['Maria'])
    expect(sendLifecycleEmail).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the trial is over (welcome to a clinic whose trial expired)', async () => {
    vi.stubEnv('LIFECYCLE_ENABLED', 'true')
    vi.mocked(findLifecycleRecipients).mockResolvedValue([recipient])
    vi.mocked(getActivationState).mockResolvedValue({
      subscriptionStatus: 'expired',
      trialDay: 0,
    } as never)

    scheduleLifecycleWelcome({ tenantId: 'tenant-1' })
    await Promise.all(pending)

    expect(sendPlatformTemplate).not.toHaveBeenCalled()
    expect(sendLifecycleEmail).not.toHaveBeenCalled()
  })

  it('does not throw out of after() when a query fails', async () => {
    vi.stubEnv('LIFECYCLE_ENABLED', 'true')
    vi.mocked(findLifecycleRecipients).mockRejectedValue(new Error('db down'))

    scheduleLifecycleWelcome({ tenantId: 'tenant-1' })

    await expect(Promise.all(pending)).resolves.toBeDefined()
  })
})
