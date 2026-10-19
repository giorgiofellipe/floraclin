import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/tenants', () => ({ getTenant: vi.fn() }))
vi.mock('@/db/queries/whatsapp', () => ({ listAutomations: vi.fn() }))
vi.mock('@/db/queries/financial', () => ({ getPaymentRecipients: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ getTemplateForTenant: vi.fn() }))
vi.mock('@/lib/whatsapp-automated-send', () => ({ sendAndRecordTemplate: vi.fn() }))
vi.mock('@/lib/plans', () => ({ isSubscriptionActive: vi.fn() }))
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }))

import { getTenant } from '@/db/queries/tenants'
import { listAutomations } from '@/db/queries/whatsapp'
import { getPaymentRecipients } from '@/db/queries/financial'
import { getTemplateForTenant } from '@/lib/whatsapp'
import { sendAndRecordTemplate } from '@/lib/whatsapp-automated-send'
import { isSubscriptionActive } from '@/lib/plans'
import { CreditExhaustedError } from '@/lib/whatsapp-credits'
import { reportSideEffectFailure } from '@/lib/observability'
import * as Sentry from '@sentry/nextjs'
import { sendPaymentConfirmations } from '../whatsapp-payment-confirmation'

const NOW = new Date('2026-10-18T12:00:00-03:00')

const MARIA = { patientId: 'p-maria', patientName: 'Maria Silva', patientPhone: '11999991234' }
const JOAO = { patientId: 'p-joao', patientName: 'João Souza', patientPhone: '11988887777' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(getTenant).mockResolvedValue({ id: 't1', name: 'Clínica Lume', settings: { whatsapp_enabled: true } } as never)
  vi.mocked(isSubscriptionActive).mockResolvedValue(true)
  vi.mocked(listAutomations).mockResolvedValue([{ trigger: 'payment_confirmation', enabled: true }] as never)
  vi.mocked(getTemplateForTenant).mockResolvedValue({
    name: 'payment_confirmation',
    language: 'pt_BR',
    status: 'APPROVED',
    purposeKey: 'payment_confirmation',
    variableMapping: null,
    components: [],
  } as never)
  vi.mocked(getPaymentRecipients).mockResolvedValue([
    { installmentId: 'i1', ...MARIA },
    { installmentId: 'i2', ...MARIA },
    { installmentId: 'i3', ...JOAO },
  ])
  vi.mocked(sendAndRecordTemplate).mockResolvedValue({ metaMessageId: 'wamid.1' } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sendPaymentConfirmations', () => {
  // Regression: a bulk pay of three installments texting the patient three times.
  it('sends one message per patient with the sum of what they paid', async () => {
    await sendPaymentConfirmations('t1', [
      { installmentId: 'i1', amount: '350.00', paidAt: NOW },
      { installmentId: 'i2', amount: '1200.50', paidAt: NOW },
      { installmentId: 'i3', amount: '99.90', paidAt: NOW },
    ])

    expect(vi.mocked(sendAndRecordTemplate).mock.calls.map(([args]) => [args.phone, args.params])).toEqual([
      ['5511999991234', { '1': 'Maria', '2': '1.550,50' }],
      ['5511988887777', { '1': 'João', '2': '99,90' }],
    ])
  })

  // Regression: entering last month's payments into the system texting each patient "we received it".
  it('skips a payment dated more than 2 BR days ago', async () => {
    await sendPaymentConfirmations('t1', [
      { installmentId: 'i1', amount: '350.00', paidAt: new Date('2026-10-16T00:30:00-03:00') },
      { installmentId: 'i3', amount: '99.90', paidAt: new Date('2026-10-15T23:30:00-03:00') },
    ])

    expect(vi.mocked(sendAndRecordTemplate).mock.calls.map(([args]) => args.recipient.patientId)).toEqual(['p-maria'])
  })

  it('sends nothing when the clinic did not turn the automation on', async () => {
    vi.mocked(listAutomations).mockResolvedValue([{ trigger: 'payment_confirmation', enabled: false }] as never)

    await sendPaymentConfirmations('t1', [{ installmentId: 'i1', amount: '350.00', paidAt: NOW }])

    expect(sendAndRecordTemplate).not.toHaveBeenCalled()
  })

  // Regression: a clinic template with an extra variable reporting one error per payer instead of one warning.
  it('sends nothing, with one warning, when the template needs a value the automation does not supply', async () => {
    vi.mocked(getTemplateForTenant).mockResolvedValue({
      name: 'payment_confirmation',
      language: 'pt_BR',
      status: 'APPROVED',
      purposeKey: 'payment_confirmation',
      variableMapping: [
        { index: 1, key: 'patient_name', label: 'Nome', example: 'Maria' },
        { index: 2, key: 'appointment_date', label: 'Data', example: '15/04/2026' },
      ],
      components: [],
    } as never)

    await sendPaymentConfirmations('t1', [
      { installmentId: 'i1', amount: '350.00', paidAt: NOW },
      { installmentId: 'i3', amount: '99.90', paidAt: NOW },
    ])

    expect(sendAndRecordTemplate).not.toHaveBeenCalled()
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(reportSideEffectFailure).not.toHaveBeenCalled()
  })

  // Regression: a send error escaping into after(), or exhausted credits paging as an error on every payment.
  it('stops at exhausted credits with a warning, without throwing', async () => {
    vi.mocked(sendAndRecordTemplate).mockRejectedValue(new CreditExhaustedError(100, 100, 1))

    await expect(
      sendPaymentConfirmations('t1', [
        { installmentId: 'i1', amount: '350.00', paidAt: NOW },
        { installmentId: 'i3', amount: '99.90', paidAt: NOW },
      ]),
    ).resolves.toBeUndefined()
    expect(sendAndRecordTemplate).toHaveBeenCalledTimes(1)
    expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'warning' }))
    expect(reportSideEffectFailure).not.toHaveBeenCalled()
  })
})
