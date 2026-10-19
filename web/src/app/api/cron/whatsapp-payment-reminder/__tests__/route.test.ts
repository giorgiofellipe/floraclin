import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-monitor', () => ({
  withCronMonitor: (_slug: string, _schedule: string, body: () => Promise<unknown>) => body(),
}))

vi.mock('@/lib/whatsapp-automation-cron', () => ({
  runTemplateAutomation: vi.fn().mockResolvedValue({ ok: true, sent: 0, outcomes: [], summary: {} }),
}))

vi.mock('@/lib/whatsapp-payment-reminder', () => ({ loadDueReminders: vi.fn() }))

import { runTemplateAutomation } from '@/lib/whatsapp-automation-cron'
import { loadDueReminders } from '@/lib/whatsapp-payment-reminder'
import { GET } from '../route'

const CRON_SECRET = 'test-cron-secret'
const URL = 'http://localhost/api/cron/whatsapp-payment-reminder'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe('GET /api/cron/whatsapp-payment-reminder', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await GET(new Request(URL))

    expect(res.status).toBe(401)
    expect(runTemplateAutomation).not.toHaveBeenCalled()
  })

  it('runs the payment_reminder automation with its loader', async () => {
    await GET(new Request(URL, { headers: { authorization: `Bearer ${CRON_SECRET}` } }))

    expect(runTemplateAutomation).toHaveBeenCalledWith('payment_reminder', loadDueReminders)
  })
})
