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
  components: [],
} as never

function dueMessage(overrides: Partial<DueMessage> = {}): DueMessage {
  return {
    ref: 'procedures r1',
    patientId: 'patient-1',
    patientName: 'Maria Silva',
    phone: '11999991234',
    params: { '1': 'Maria', '2': 'Botox' },
    markSent: vi.fn().mockResolvedValue(undefined),
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
  it('does not load or send anything when the automation is off for the tenant', async () => {
    vi.mocked(listAutomations).mockResolvedValue([
      { trigger: 'follow_up', enabled: false, config: {} },
      { trigger: 'payment_reminder', enabled: true, config: {} },
    ] as never)
    const loadDue = vi.fn()

    const result = await runTemplateAutomation('follow_up', loadDue)

    expect(result.outcomes[0].reason).toBe('no_automation')
    expect(loadDue).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('does not send while the template is not approved', async () => {
    vi.mocked(getTemplateForTenant).mockResolvedValue({ ...(TEMPLATE as object), status: 'PENDING' } as never)
    const loadDue = vi.fn()

    const result = await runTemplateAutomation('follow_up', loadDue)

    expect(result.outcomes[0].reason).toBe('template_not_approved')
    expect(loadDue).not.toHaveBeenCalled()
  })

  it('sends the template for the trigger with the loader params and the automation config', async () => {
    const message = dueMessage()
    const loadDue = vi.fn().mockResolvedValue([message])

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
    )
    expect(message.markSent).toHaveBeenCalledTimes(1)
    expect(result.outcomes[0]).toMatchObject({ reason: 'sent', sent: 1, failed: 0 })
  })

  it('marks a sent message even when recording it in the inbox fails, so it is not sent twice', async () => {
    vi.mocked(createMessage).mockRejectedValue(new Error('db down'))
    const message = dueMessage()

    await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([message]))

    expect(message.markSent).toHaveBeenCalledTimes(1)
  })

  it('stops the tenant at credit exhaustion without marking the unsent message', async () => {
    vi.mocked(sendTemplateMessage)
      .mockResolvedValueOnce({ metaMessageId: 'wamid.1' })
      .mockRejectedValueOnce(new CreditExhaustedError(100, 100, 1))
    const first = dueMessage({ ref: 'a' })
    const second = dueMessage({ ref: 'b' })
    const third = dueMessage({ ref: 'c' })

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([first, second, third]))

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2)
    expect(second.markSent).not.toHaveBeenCalled()
    expect(third.markSent).not.toHaveBeenCalled()
    expect(result.outcomes[0]).toMatchObject({ reason: 'credit_exhausted', sent: 1 })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('skips an invalid phone without reporting it, and still sends the rest', async () => {
    const invalid = dueMessage({ ref: 'a', phone: '123' })
    const valid = dueMessage({ ref: 'b' })

    const result = await runTemplateAutomation('follow_up', vi.fn().mockResolvedValue([invalid, valid]))

    expect(invalid.markSent).not.toHaveBeenCalled()
    expect(valid.markSent).toHaveBeenCalledTimes(1)
    expect(result.outcomes[0]).toMatchObject({ reason: 'sent', sent: 1, failed: 0 })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})
