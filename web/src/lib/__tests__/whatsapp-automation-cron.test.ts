import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureExceptionMock = vi.fn()
const captureMessageMock = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

vi.mock('@/db/client', () => ({
  db: { select: vi.fn().mockReturnThis(), from: vi.fn() },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', name: 'name', settings: 'settings' },
}))

vi.mock('@/db/queries/whatsapp', () => ({
  listAutomations: vi.fn(),
  upsertConversation: vi.fn(),
  createMessage: vi.fn(),
  pushSseEvent: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplateMessage: vi.fn(),
  resolveTemplateBody: vi.fn(),
  getTemplateForTenant: vi.fn(),
}))

vi.mock('@/lib/plans', () => ({
  isSubscriptionActive: vi.fn(),
}))

import { db } from '@/db/client'
import { listAutomations, upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, getTemplateForTenant } from '@/lib/whatsapp'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { isSubscriptionActive } from '@/lib/plans'
import { runTemplateAutomation, type DueMessage } from '../whatsapp-automation-cron'

const dbMock = db as unknown as { from: ReturnType<typeof vi.fn> }

const TEMPLATE = {
  name: 'follow_up',
  language: 'pt_BR',
  status: 'APPROVED',
  purposeKey: 'follow_up',
  variableMapping: null,
  components: [],
} as never

function dueMessage(overrides: Partial<DueMessage> = {}): DueMessage {
  return {
    ref: 'sessions s1',
    patientId: 'patient-1',
    patientName: 'Maria Silva',
    phone: '11999991234',
    values: { patient_name: 'Maria', procedure_name: 'Botox' },
    claim: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.from.mockResolvedValue([{ id: 't1', name: 'Clínica Lume', settings: null }])
  vi.mocked(isSubscriptionActive).mockResolvedValue(true)
  vi.mocked(listAutomations).mockResolvedValue([
    { trigger: 'follow_up', enabled: true, config: { daysAfterProcedure: 5 } },
  ] as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue(TEMPLATE)
  vi.mocked(sendTemplateMessage).mockResolvedValue({ metaMessageId: 'wamid.1' })
  vi.mocked(resolveTemplateBody).mockReturnValue('body')
  vi.mocked(upsertConversation).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as never)
  vi.mocked(pushSseEvent).mockResolvedValue(undefined as never)
})

describe('runTemplateAutomation', () => {
  // Each gate keeps paid messages from going out for a clinic that should not get them.
  it.each([
    ['WhatsApp is off on its own number', 'wa_disabled', () => {
      dbMock.from.mockResolvedValue([
        { id: 't1', name: 'Clínica Lume', settings: { whatsapp_mode: 'own', whatsapp_enabled: false } },
      ])
    }],
    ['the subscription is inactive', 'subscription_inactive', () => {
      vi.mocked(isSubscriptionActive).mockResolvedValue(false)
    }],
    ['the automation is off', 'no_automation', () => {
      vi.mocked(listAutomations).mockResolvedValue([
        { trigger: 'follow_up', enabled: false, config: {} },
        { trigger: 'payment_reminder', enabled: true, config: {} },
      ] as never)
    }],
    ['the template is not approved', 'template_not_approved', () => {
      vi.mocked(getTemplateForTenant).mockResolvedValue({ ...(TEMPLATE as object), status: 'PENDING' } as never)
    }],
  ])('does not load or send anything when %s', async (_label, reason, arrange) => {
    arrange()
    const loadDue = vi.fn()

    const result = await runTemplateAutomation('follow_up', loadDue)

    expect(result.outcomes[0].reason).toBe(reason)
    expect(loadDue).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('claims nothing when the template needs a value the automation does not supply', async () => {
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      ...(TEMPLATE as object),
      variableMapping: [
        { index: 1, key: 'patient_name', label: 'Nome', example: 'Maria' },
        { index: 2, key: 'appointment_date', label: 'Data', example: '15/04/2026' },
      ],
    } as never)
    const message = dueMessage()

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([message]))

    expect(result.outcomes[0].reason).toBe('template_incompatible')
    expect(message.claim).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(captureMessageMock).toHaveBeenCalledTimes(1)
  })

  it('sends the trigger template with positional params built from the keyed values', async () => {
    const loadDue = vi.fn().mockResolvedValue([dueMessage()])

    const result = await runTemplateAutomation('follow_up', loadDue)

    expect(getTemplateForTenant).toHaveBeenCalledWith('t1', 'follow_up')
    expect(loadDue).toHaveBeenCalledWith({
      tenantId: 't1',
      tenantName: 'Clínica Lume',
      config: { daysAfterProcedure: 5 },
    })
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      't1',
      { actor: { type: 'system' }, recipient: { patientId: 'patient-1', name: 'Maria Silva' } },
      '5511999991234',
      'follow_up',
      'pt_BR',
      { '1': 'Maria', '2': 'Botox' },
      undefined,
    )
    expect(result.outcomes[0]).toMatchObject({ reason: 'sent', sent: 1, failed: 0 })
  })

  it('reports a stored config the schema rejects instead of sending with it', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      { trigger: 'follow_up', enabled: true, config: { daysAfterProcedure: -3 } },
    ] as never)
    const loadDue = vi.fn()

    const result = await runTemplateAutomation('follow_up', loadDue)

    expect(result.outcomes[0].reason).toBe('tenant_error')
    expect(loadDue).not.toHaveBeenCalled()
  })

  it('skips a message another run already claimed', async () => {
    const message = dueMessage({ claim: vi.fn().mockResolvedValue(false) })

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([message]))

    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(result.outcomes[0]).toMatchObject({ reason: 'no_messages_due', sent: 0 })
  })

  it('counts the message as sent and keeps its claim when only the inbox write fails', async () => {
    vi.mocked(createMessage).mockRejectedValue(new Error('db down'))
    const message = dueMessage()

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([message]))

    expect(message.release).not.toHaveBeenCalled()
    expect(result.outcomes[0]).toMatchObject({ reason: 'sent', sent: 1, failed: 0 })
  })

  it('releases the claim when the send fails, so the next run retries it', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(new Error('Meta API error'))
    const message = dueMessage()

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([message]))

    expect(message.release).toHaveBeenCalledTimes(1)
    expect(result.outcomes[0]).toMatchObject({ reason: 'send_failed', failed: 1 })
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('stops the tenant at credit exhaustion, releasing the unsent message and claiming no more', async () => {
    vi.mocked(sendTemplateMessage)
      .mockResolvedValueOnce({ metaMessageId: 'wamid.1' })
      .mockRejectedValueOnce(new CreditExhaustedError(100, 100, 1))
    const first = dueMessage({ ref: 'a' })
    const second = dueMessage({ ref: 'b' })
    const third = dueMessage({ ref: 'c' })

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([first, second, third]))

    expect(first.release).not.toHaveBeenCalled()
    expect(second.release).toHaveBeenCalledTimes(1)
    expect(third.claim).not.toHaveBeenCalled()
    expect(result.outcomes[0]).toMatchObject({ reason: 'credit_exhausted', sent: 1 })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('skips an invalid phone without claiming or reporting it, and still sends the rest', async () => {
    const invalid = dueMessage({ ref: 'a', phone: '123' })
    const valid = dueMessage({ ref: 'b' })

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([invalid, valid]))

    expect(invalid.claim).not.toHaveBeenCalled()
    expect(valid.release).not.toHaveBeenCalled()
    expect(result.outcomes[0]).toMatchObject({ reason: 'sent', sent: 1, failed: 0 })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})
