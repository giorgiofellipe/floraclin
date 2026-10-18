import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-monitor', () => ({
  withCronMonitor: (_slug: string, _schedule: string, body: () => Promise<unknown>) => body(),
}))

vi.mock('@/lib/whatsapp-automation-cron', () => ({
  runTemplateAutomation: vi.fn(),
}))

vi.mock('@/db/queries/financial', () => ({
  getInstallmentsDueReminder: vi.fn(),
  markPaymentReminderSent: vi.fn(),
}))

import { runTemplateAutomation, type DueMessage, type LoadDueArgs } from '@/lib/whatsapp-automation-cron'
import { getInstallmentsDueReminder, markPaymentReminderSent } from '@/db/queries/financial'
import { GET } from '../route'

const CRON_SECRET = 'test-cron-secret'

async function loadDue(config: Record<string, unknown>): Promise<DueMessage[]> {
  let messages: DueMessage[] = []
  vi.mocked(runTemplateAutomation).mockImplementation(async (_trigger, loader) => {
    messages = await loader({ tenantId: 't1', tenantName: 'Clínica Lume', config } satisfies LoadDueArgs)
    return { ok: true, sent: 0, outcomes: [], summary: {} }
  })
  await GET(new Request('http://localhost/api/cron/whatsapp-payment-reminder', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }))
  return messages
}

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    amount: '1500.00',
    amountPaid: '265.50',
    dueDate: '2026-10-20',
    patientId: 'p1',
    patientName: 'Maria Silva',
    patientPhone: '11999991234',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  vi.useFakeTimers({ toFake: ['Date'] })
  // 2026-10-17 22:00 BRT, already the 18th in UTC
  vi.setSystemTime(new Date('2026-10-18T01:00:00Z'))
  vi.mocked(getInstallmentsDueReminder).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cron/whatsapp-payment-reminder', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/cron/whatsapp-payment-reminder'))

    expect(res.status).toBe(401)
    expect(runTemplateAutomation).not.toHaveBeenCalled()
  })

  it('runs the payment_reminder automation', async () => {
    await loadDue({})

    expect(runTemplateAutomation).toHaveBeenCalledWith('payment_reminder', expect.any(Function))
  })

  it('looks up installments due from the BR today through daysBeforeDue days ahead', async () => {
    await loadDue({ daysBeforeDue: 5 })

    expect(getInstallmentsDueReminder).toHaveBeenCalledWith('t1', '2026-10-17', '2026-10-22')
  })

  it('reminds the open balance with the clinic name and BR due date, and marks that installment', async () => {
    vi.mocked(getInstallmentsDueReminder).mockResolvedValue([installment()])

    const [message] = await loadDue({})

    expect(message.params).toEqual({ '1': 'Maria', '2': '1.234,50', '3': 'Clínica Lume', '4': '20/10/2026' })
    await message.markSent()
    expect(markPaymentReminderSent).toHaveBeenCalledWith('t1', 'i1')
  })

  it('skips an installment already paid in full', async () => {
    vi.mocked(getInstallmentsDueReminder).mockResolvedValue([installment({ amountPaid: '1500.00' })])

    expect(await loadDue({})).toEqual([])
  })
})
