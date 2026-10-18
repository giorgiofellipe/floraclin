import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-monitor', () => ({
  withCronMonitor: (_slug: string, _schedule: string, body: () => Promise<unknown>) => body(),
}))

vi.mock('@/lib/whatsapp-automation-cron', () => ({
  runTemplateAutomation: vi.fn(),
}))

vi.mock('@/db/queries/procedures', () => ({
  getProceduresDueFollowUp: vi.fn(),
  markFollowUpSent: vi.fn(),
}))

import { runTemplateAutomation, type DueMessage, type LoadDueArgs } from '@/lib/whatsapp-automation-cron'
import { getProceduresDueFollowUp, markFollowUpSent } from '@/db/queries/procedures'
import { GET } from '../route'

const CRON_SECRET = 'test-cron-secret'

async function loadDue(config: Record<string, unknown>): Promise<DueMessage[]> {
  let messages: DueMessage[] = []
  vi.mocked(runTemplateAutomation).mockImplementation(async (_trigger, loader) => {
    messages = await loader({ tenantId: 't1', tenantName: 'Clínica Lume', config } satisfies LoadDueArgs)
    return { ok: true, sent: 0, outcomes: [], summary: {} }
  })
  await GET(new Request('http://localhost/api/cron/whatsapp-follow-up', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }))
  return messages
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    patientId: 'p1',
    patientName: 'Maria Silva',
    patientPhone: '11999991234',
    procedureTypeName: 'Botox',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  vi.useFakeTimers({ toFake: ['Date'] })
  // 2026-10-18 10:00 BRT
  vi.setSystemTime(new Date('2026-10-18T13:00:00Z'))
  vi.mocked(getProceduresDueFollowUp).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cron/whatsapp-follow-up', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/cron/whatsapp-follow-up'))

    expect(res.status).toBe(401)
    expect(runTemplateAutomation).not.toHaveBeenCalled()
  })

  it('runs the follow_up automation', async () => {
    await loadDue({})

    expect(runTemplateAutomation).toHaveBeenCalledWith('follow_up', expect.any(Function))
  })

  it('looks up procedures performed daysAfterProcedure BR days ago, plus the catch-up days', async () => {
    await loadDue({ daysAfterProcedure: 5 })

    expect(getProceduresDueFollowUp).toHaveBeenCalledWith(
      't1',
      new Date('2026-10-11T03:00:00.000Z'),
      new Date('2026-10-14T02:59:59.999Z'),
    )
  })

  it('sends one message per patient, naming every procedure, and marks all of them sent', async () => {
    vi.mocked(getProceduresDueFollowUp).mockResolvedValue([
      record({ id: 'r1', procedureTypeName: 'Botox' }),
      record({ id: 'r2', procedureTypeName: 'Preenchimento labial' }),
      record({ id: 'r3', procedureTypeName: 'Bioestimulador' }),
      record({ id: 'r4', patientId: 'p2', patientName: 'Ana', procedureTypeName: 'Botox' }),
    ])

    const messages = await loadDue({})

    expect(messages).toHaveLength(2)
    expect(messages[0].params).toEqual({ '1': 'Maria', '2': 'Botox, Preenchimento labial e Bioestimulador' })
    expect(messages[1].params).toEqual({ '1': 'Ana', '2': 'Botox' })

    await messages[0].markSent()
    expect(markFollowUpSent).toHaveBeenCalledWith('t1', ['r1', 'r2', 'r3'])
  })
})
