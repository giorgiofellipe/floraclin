import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/procedures', () => ({
  getSessionsDueFollowUp: vi.fn(),
  getProcedureTypeNames: vi.fn(),
  claimFollowUp: vi.fn(),
  releaseFollowUp: vi.fn(),
}))

import { claimFollowUp, getProcedureTypeNames, getSessionsDueFollowUp, releaseFollowUp } from '@/db/queries/procedures'
import { loadDueFollowUps } from '../whatsapp-follow-up'

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    patientId: 'p1',
    patientName: 'Maria Silva',
    patientPhone: '11999991234',
    procedureTypeName: 'Botox',
    additionalTypeIds: [],
    ...overrides,
  }
}

const ARGS = { tenantId: 't1', tenantName: 'Clínica Lume', config: { daysAfterProcedure: 5 } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 2026-10-18 09:30 BRT
  vi.setSystemTime(new Date('2026-10-18T12:30:00Z'))
  vi.mocked(getSessionsDueFollowUp).mockResolvedValue([])
  vi.mocked(getProcedureTypeNames).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadDueFollowUps', () => {
  it('looks up sessions performed daysAfterProcedure BR days ago, plus the catch-up days', async () => {
    await loadDueFollowUps(ARGS)

    expect(getSessionsDueFollowUp).toHaveBeenCalledWith(
      't1',
      new Date('2026-10-11T03:00:00.000Z'),
      new Date('2026-10-14T02:59:59.999Z'),
    )
  })

  it('sends one message per patient naming every procedure, additional types included, and claims all its sessions', async () => {
    vi.mocked(getSessionsDueFollowUp).mockResolvedValue([
      session({ id: 's1', procedureTypeName: 'Botox', additionalTypeIds: ['type-lip'] }),
      session({ id: 's2', procedureTypeName: 'Bioestimulador' }),
      session({ id: 's3', patientId: 'p2', patientName: 'Ana', procedureTypeName: 'Botox' }),
    ])
    vi.mocked(getProcedureTypeNames).mockResolvedValue([{ id: 'type-lip', name: 'Preenchimento labial' }])
    vi.mocked(claimFollowUp).mockResolvedValue(['s1', 's2'])

    const messages = await loadDueFollowUps(ARGS)

    expect(messages.map((m) => m.values)).toEqual([
      { patient_name: 'Maria', procedure_name: 'Botox, Preenchimento labial e Bioestimulador' },
      { patient_name: 'Ana', procedure_name: 'Botox' },
    ])
    await messages[0].claim()
    expect(claimFollowUp).toHaveBeenCalledWith('t1', ['s1', 's2'])
  })

  // Regression: releasing the whole group cleared a session another run had
  // claimed and sent, so the next run sent its follow-up again.
  it('releases only the sessions its own claim took', async () => {
    vi.mocked(getSessionsDueFollowUp).mockResolvedValue([session({ id: 's1' }), session({ id: 's3' })])
    vi.mocked(claimFollowUp).mockResolvedValue(['s3'])

    const [message] = await loadDueFollowUps(ARGS)
    await message.claim()
    await message.release()

    expect(releaseFollowUp).toHaveBeenCalledWith('t1', ['s3'])
  })

  it('reports a group as taken when another run already claimed its sessions', async () => {
    vi.mocked(getSessionsDueFollowUp).mockResolvedValue([session()])
    vi.mocked(claimFollowUp).mockResolvedValue([])

    const [message] = await loadDueFollowUps(ARGS)

    expect(await message.claim()).toBe(false)
  })
})
