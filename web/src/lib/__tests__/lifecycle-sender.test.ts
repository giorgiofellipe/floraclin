import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  isFirstTemplateNotApprovedSkipToday: vi.fn(),
  recordSkippedLifecycleSend: vi.fn(),
  findLifecycleRecipients: vi.fn(),
}))
vi.mock('@/lib/platform-whatsapp', () => ({ sendPlatformTemplate: vi.fn(), findPlatformTemplate: vi.fn() }))
vi.mock('@/lib/discord', () => ({ notifyDiscord: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendLifecycleEmail: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
import { reportSideEffectFailure } from '@/lib/observability'
import { BusinessError } from '@/lib/errors'
vi.mock('@/lib/activation', () => ({ getActivationState: vi.fn() }))
// Live data for messages with a `render` (last day, win-back, final).
vi.mock('@/db/queries/subscriptions', () => ({
  getSubscription: vi.fn(async () => ({
    status: 'trialing',
    source: 'trial',
    stripeSubscriptionId: null,
    firstPaidAt: null,
    currentPeriodEnd: new Date('2026-10-22T21:30:00.000Z'),
  })),
  listPlans: vi.fn(async () => [
    { slug: 'starter', name: 'Starter', priceCents: 9900, stripePriceId: 'price_starter' },
    { slug: 'pro', name: 'Pro', priceCents: 19900, stripePriceId: 'price_pro' },
  ]),
}))
vi.mock('@/db/queries/trial-recap', () => ({
  getTrialRecap: vi.fn(async () => ({ patients: 3, appointments: 5, procedureRecords: 1, photos: 0, diagrams: 0 })),
}))
vi.mock('@/lib/winback-offer', () => ({ getValidatedWinbackOffer: vi.fn(async () => null) }))
vi.mock('@/lib/lifecycle-opt-out', () => ({
  lifecycleOptOutUrl: vi.fn((tenantId: string) => `https://opt-out.test/${tenantId}`),
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))

import {
  claimLifecycleSend,
  finishLifecycleSend,
  findLifecycleRecipients,
  isFirstTemplateNotApprovedSkipToday,
  isTenantLifecycleOptedOut,
  recordSkippedLifecycleSend,
} from '@/db/queries/lifecycle'
import { findPlatformTemplate, sendPlatformTemplate } from '@/lib/platform-whatsapp'
import { notifyDiscord } from '@/lib/discord'
import { clearLifecycleTemplateApprovalCache } from '@/lib/lifecycle-template-status'
import { sendLifecycleEmail } from '@/lib/email'
import { getActivationState } from '@/lib/activation'
import { LIFECYCLE_MESSAGES } from '@/lib/lifecycle-messages'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
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

const template = (status: string) => ({
  id: 'tpl-1',
  name: 'any',
  status,
  category: 'MARKETING',
  rejectedReason: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  pending.length = 0
  vi.unstubAllEnvs()
  vi.mocked(claimLifecycleSend).mockImplementation(async ({ channel }) => `row-${channel}`)
  vi.mocked(sendPlatformTemplate).mockResolvedValue({ metaMessageId: 'wamid.1' })
  vi.mocked(sendLifecycleEmail).mockResolvedValue({ id: 'email-1' })
  vi.mocked(findPlatformTemplate).mockResolvedValue(template('APPROVED'))
  vi.mocked(recordSkippedLifecycleSend).mockResolvedValue('skip-1')
  vi.mocked(isFirstTemplateNotApprovedSkipToday).mockResolvedValue(true)
  clearLifecycleTemplateApprovalCache()
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
    expect(findPlatformTemplate).not.toHaveBeenCalled()
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

  it.each(LIFECYCLE_MESSAGES.map((m) => m.key))(
    'sends %s by WhatsApp once Meta reports its template APPROVED',
    async (key) => {
      const message = LIFECYCLE_MESSAGES.find((m) => m.key === key)!
      const outcome = await deliverLifecycleMessage(recipient, message)

      expect(outcome).toEqual({ whatsapp: 'sent', email: 'sent' })
      expect(findPlatformTemplate).toHaveBeenCalledWith(message.templateName)
      expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', message.templateName, ['Maria'], {
        buttonUrlParams: message.button ? ['row-whatsapp'] : [],
      })
      expect(recordSkippedLifecycleSend).not.toHaveBeenCalled()
      expect(notifyDiscord).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['PENDING', template('PENDING')],
    ['REJECTED', template('REJECTED')],
    ['MISSING', null],
  ])(
    'sends by email only while the template is %s, records the WhatsApp skip so the key completes, and alerts Discord',
    async (status, found) => {
      vi.mocked(findPlatformTemplate).mockResolvedValue(found)
      const message = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_last_day')!

      const outcome = await deliverLifecycleMessage(recipient, message)

      expect(outcome).toEqual({ whatsapp: 'skipped', email: 'sent' })
      expect(sendPlatformTemplate).not.toHaveBeenCalled()
      expect(claimLifecycleSend).not.toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp' }))
      expect(recordSkippedLifecycleSend).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        messageKey: 'trial_last_day',
        channel: 'whatsapp',
        recipient: '5511987654321',
        reason: 'template_not_approved',
      })
      expect(isFirstTemplateNotApprovedSkipToday).toHaveBeenCalledWith('trial_last_day', 'skip-1')
      expect(notifyDiscord).toHaveBeenCalledTimes(1)
      expect(notifyDiscord).toHaveBeenCalledWith({
        kind: 'lifecycle.template_not_approved',
        templateName: message.templateName,
        messageKey: 'trial_last_day',
        status,
      })
      expect(sendLifecycleEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            button: expect.objectContaining({ url: expect.stringContaining('/api/lifecycle/click') }),
            optOutUrl: expect.any(String),
          }),
        }),
      )
    },
  )

  it('alerts once per message key per day: a second skip of the same key sends no second alert', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('PENDING'))
    const message = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_winback')!

    await deliverLifecycleMessage(recipient, message)
    vi.mocked(recordSkippedLifecycleSend).mockResolvedValue('skip-2')
    await deliverLifecycleMessage({ ...recipient, tenantId: 'tenant-2' }, message)

    expect(recordSkippedLifecycleSend).toHaveBeenCalledTimes(2)
    expect(isFirstTemplateNotApprovedSkipToday).toHaveBeenCalledTimes(1)
    expect(notifyDiscord).toHaveBeenCalledTimes(1)
  })

  it('sends no alert when another instance already recorded the first skip of the day', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('PENDING'))
    vi.mocked(isFirstTemplateNotApprovedSkipToday).mockResolvedValue(false)

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'skipped', email: 'sent' })
    expect(notifyDiscord).not.toHaveBeenCalled()
  })

  it('sends no alert when the skip row already existed (insert conflict)', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('PENDING'))
    vi.mocked(recordSkippedLifecycleSend).mockResolvedValue(null)

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'skipped', email: 'sent' })
    expect(isFirstTemplateNotApprovedSkipToday).not.toHaveBeenCalled()
    expect(notifyDiscord).not.toHaveBeenCalled()
  })

  it('still sends the email when the alert dedupe check fails', async () => {
    vi.mocked(findPlatformTemplate).mockResolvedValue(template('PENDING'))
    vi.mocked(isFirstTemplateNotApprovedSkipToday).mockRejectedValue(new Error('db down'))

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'skipped', email: 'sent' })
    expect(notifyDiscord).not.toHaveBeenCalled()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'template_alert' }))
  })

  it('attempts the WhatsApp send when the template lookup fails, recording no template_not_approved skip', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(findPlatformTemplate).mockRejectedValue(new Error('Meta API error: timeout'))

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'sent', email: 'sent' })
    expect(sendPlatformTemplate).toHaveBeenCalledTimes(1)
    expect(recordSkippedLifecycleSend).not.toHaveBeenCalled()
    expect(notifyDiscord).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ step: 'template_status' }))
    consoleError.mockRestore()
  })

  it('records a failed WhatsApp row when the lookup fails and Meta then rejects the send', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(findPlatformTemplate).mockRejectedValue(new Error('Meta API error: timeout'))
    vi.mocked(sendPlatformTemplate).mockRejectedValue(new Error('Meta API error: template not approved'))

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'failed', email: 'sent' })
    expect(recordSkippedLifecycleSend).not.toHaveBeenCalled()
    expect(finishLifecycleSend).toHaveBeenCalledWith('row-whatsapp', {
      status: 'failed',
      error: 'Meta API error: template not approved',
    })
    consoleError.mockRestore()
  })

  it('does not report the lookup when WhatsApp is not configured, and still attempts the send', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const notConfigured = new BusinessError('WHATSAPP_NOT_CONFIGURED')
    vi.mocked(findPlatformTemplate).mockRejectedValue(notConfigured)
    vi.mocked(sendPlatformTemplate).mockRejectedValue(notConfigured)

    const outcome = await deliverLifecycleMessage(recipient, utility)

    expect(outcome).toEqual({ whatsapp: 'failed', email: 'sent' })
    expect(sendPlatformTemplate).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    expect(reportSideEffectFailure).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ step: 'template_status' }))
    // The send path reports it once.
    expect(reportSideEffectFailure).toHaveBeenCalledWith(notConfigured, expect.objectContaining({ step: 'whatsapp' }))
    consoleError.mockRestore()
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
    expect(findPlatformTemplate).not.toHaveBeenCalled()
    expect(sendPlatformTemplate).not.toHaveBeenCalled()
  })

  it('sends the WhatsApp template to the normalized phone with the first name and the send id for the button', async () => {
    await deliverLifecycleMessage(recipient, utility)

    expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', utility.templateName, ['Maria'], {
      buttonUrlParams: ['row-whatsapp'],
    })
    expect(finishLifecycleSend).toHaveBeenCalledWith('row-whatsapp', expect.objectContaining({
      status: 'sent',
      metaMessageId: 'wamid.1',
    }))
  })

  it('sends no button param for a message without a button', async () => {
    const noButton = { ...utility, button: null }

    await deliverLifecycleMessage(recipient, noButton)

    expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', noButton.templateName, ['Maria'], {
      buttonUrlParams: [],
    })
  })

  describe('win-back offer on WhatsApp', () => {
    const winback = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_winback')!
    const offer = {
      promotionCodeId: 'promo_1',
      label: '30% de desconto nos 3 primeiros meses',
      endsAt: '2026-11-07T02:59:59.999Z',
      percentOff: 30,
      amountOffCents: null,
      duration: 'repeating' as const,
      durationInMonths: 3,
      planSlugs: ['starter', 'pro'],
    }
    const offerTemplateStatus = (status: string) =>
      vi.mocked(findPlatformTemplate).mockImplementation(async (name) =>
        template(name === winback.offerTemplate!.name ? status : 'APPROVED'),
      )

    beforeEach(() => {
      // The 10:00 BRT cron run two days after a trial that ended on 10-23.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-25T13:00:00.000Z'))
      vi.mocked(getValidatedWinbackOffer).mockResolvedValue(offer)
    })
    afterEach(() => vi.useRealTimers())

    it('names the offer and its last day, like the email. Regression: WhatsApp sends the plain copy while the email has the offer', async () => {
      offerTemplateStatus('APPROVED')

      await deliverLifecycleMessage(recipient, winback)

      expect(sendPlatformTemplate).toHaveBeenCalledWith(
        '5511987654321',
        'trial_winback_offer_click',
        ['Maria', '30% de desconto nos 3 primeiros meses', '06/11'],
        { buttonUrlParams: ['row-whatsapp'] },
      )
      expect(vi.mocked(sendLifecycleEmail).mock.calls[0][0].subject).toContain(offer.label)
    })

    it.each([
      ['the offer template is still PENDING on Meta', () => offerTemplateStatus('PENDING')],
      ['Stripe confirms no offer', () => {
        offerTemplateStatus('APPROVED')
        vi.mocked(getValidatedWinbackOffer).mockResolvedValue(null)
      }],
      ['loading the offer fails', () => {
        offerTemplateStatus('APPROVED')
        vi.mocked(getValidatedWinbackOffer).mockRejectedValueOnce(new Error('stripe down'))
      }],
    ])('sends the plain template when %s. Regression: the offer costs the clinic its WhatsApp', async (_case, arrange) => {
      arrange()

      const outcome = await deliverLifecycleMessage(recipient, winback)

      expect(outcome.whatsapp).toBe('sent')
      expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', 'trial_winback_click', ['Maria'], {
        buttonUrlParams: ['row-whatsapp'],
      })
      expect(recordSkippedLifecycleSend).not.toHaveBeenCalled()
      expect(notifyDiscord).not.toHaveBeenCalled()
    })
  })

  it('renders live data into the last-day email: the end time and what the clinic built', async () => {
    // The 10:00 BRT cron run the day before a trial that ends at 18:30.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T13:00:00.000Z'))
    const message = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_last_day')!

    await deliverLifecycleMessage(recipient, message).finally(() => vi.useRealTimers())

    const [call] = vi.mocked(sendLifecycleEmail).mock.calls
    expect(call[0].subject).toBe('Seu teste na FloraClin termina amanhã às 18:30')
    // No offer in the last-day email, so no Stripe check either.
    expect(getValidatedWinbackOffer).not.toHaveBeenCalled()
    expect(call[0].content.points).toEqual(['3 pacientes cadastrados', '5 agendamentos', '1 atendimento registrado'])
  })

  it('sends the help email with replies going to the help address', async () => {
    const message = LIFECYCLE_MESSAGES.find((m) => m.key === 'trial_help')!

    await deliverLifecycleMessage(recipient, message)

    expect(vi.mocked(sendLifecycleEmail).mock.calls[0][0].replyTo).toBe('contato@floraclin.com.br')
  })

  it('passes an opt-out URL for MARKETING emails and null for UTILITY', async () => {
    await deliverLifecycleMessage(recipient, marketing)
    await deliverLifecycleMessage(recipient, utility)

    const [marketingCall, utilityCall] = vi.mocked(sendLifecycleEmail).mock.calls
    expect(marketingCall[0].content.optOutUrl).toBe('https://opt-out.test/tenant-1')
    expect(utilityCall[0].content.optOutUrl).toBeNull()
  })

  it('points the email button at the click route for this send and stores the Resend id', async () => {
    const withButton = LIFECYCLE_MESSAGES.find((m) => m.button)!

    await deliverLifecycleMessage(recipient, withButton)

    const button = vi.mocked(sendLifecycleEmail).mock.calls[0][0].content.button
    expect(button).toEqual({
      label: withButton.button!.label,
      url: 'https://app.test/api/lifecycle/click?lc=row-email',
    })
    expect(finishLifecycleSend).toHaveBeenCalledWith('row-email', expect.objectContaining({
      providerMessageId: 'email-1',
    }))
  })
})

describe('scheduleLifecycleWelcome', () => {
  const dueState = { subscriptionStatus: 'trialing', trialDay: 0, msLeft: 14 * 24 * 60 * 60 * 1000 } as never

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

    expect(sendPlatformTemplate).toHaveBeenCalledWith('5511987654321', 'trial_welcome_click', ['Maria'], {
      buttonUrlParams: ['row-whatsapp'],
    })
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
