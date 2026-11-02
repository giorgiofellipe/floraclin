import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captureMessageMock, reportMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn(), reportMock: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureMessage: captureMessageMock, captureException: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: reportMock }))
vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/whatsapp', () => ({ listAutomations: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ getTemplateForTenant: vi.fn() }))
vi.mock('@/lib/whatsapp-automated-send', () => ({ sendAndRecordTemplate: vi.fn() }))
vi.mock('@/lib/whatsapp-blueprints', () => ({ buildTemplateParams: vi.fn(() => []), missingTemplateKeys: vi.fn(() => []) }))
vi.mock('@/lib/plans', () => ({ isSubscriptionActive: vi.fn() }))
vi.mock('@/lib/email-confirmation-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-confirmation-gate')>()),
  isTenantAwaitingEmailConfirmation: vi.fn(),
}))

import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { isSubscriptionActive } from '@/lib/plans'
import { EmailConfirmationRequiredError, isTenantAwaitingEmailConfirmation } from '@/lib/email-confirmation-gate'
import { runEventAutomation, type EventMessage } from '../whatsapp-automation-event'

const message = (ref: string): EventMessage => ({
  ref,
  patientId: 'patient-1',
  patientName: 'Maria Silva',
  phone: '11999991234',
  values: { patient_name: 'Maria' },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: null } as never)
  vi.mocked(isSubscriptionActive).mockResolvedValue(true)
  vi.mocked(isTenantAwaitingEmailConfirmation).mockResolvedValue(false)
  vi.mocked(listAutomations).mockResolvedValue([{ trigger: 'post_procedure_care', enabled: true, config: {} }] as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({ name: 'care', status: 'APPROVED' } as never)
  vi.mocked(sendAndRecordTemplate).mockResolvedValue(undefined as never)
})

describe('runEventAutomation for a clinic whose owner has not confirmed the e-mail', () => {
  it('loads and sends nothing', async () => {
    vi.mocked(isTenantAwaitingEmailConfirmation).mockResolvedValue(true)
    const loadMessages = vi.fn()

    await runEventAutomation('post_procedure_care', 't1', loadMessages)

    expect(loadMessages).not.toHaveBeenCalled()
    expect(sendAndRecordTemplate).not.toHaveBeenCalled()
  })

  it('stops quietly when a send is refused for it, without reporting a failure', async () => {
    vi.mocked(sendAndRecordTemplate).mockRejectedValueOnce(new EmailConfirmationRequiredError())

    await runEventAutomation('post_procedure_care', 't1', vi.fn().mockResolvedValue([message('a'), message('b')]))

    expect(sendAndRecordTemplate).toHaveBeenCalledTimes(1)
    expect(reportMock).not.toHaveBeenCalled()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })
})
