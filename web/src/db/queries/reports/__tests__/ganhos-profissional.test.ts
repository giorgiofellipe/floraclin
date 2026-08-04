import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/queries/cash-movements', () => ({
  getPractitionerPL: vi.fn(),
}))

import { getPractitionerPL, type PractitionerPLRow } from '@/db/queries/cash-movements'
import { listPractitionerEarnings } from '../ganhos-profissional'

function row(overrides: Partial<PractitionerPLRow> = {}): PractitionerPLRow {
  return {
    practitionerId: 'p1',
    practitionerName: 'Dra. Ana',
    revenueGenerated: 1000,
    revenueCollected: 800,
    procedureCount: 5,
    averageTicket: 200,
    byProcedureType: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listPractitionerEarnings', () => {
  it('passes tenantId, dateFrom, dateTo and practitionerId straight through to getPractitionerPL', async () => {
    vi.mocked(getPractitionerPL).mockResolvedValue([])

    await listPractitionerEarnings('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      practitionerId: 'p1',
    })

    expect(getPractitionerPL).toHaveBeenCalledWith('tenant-1', '2026-04-01', '2026-04-30', 'p1')
  })

  it('defaults to descending gross revenue when no sort is given', async () => {
    vi.mocked(getPractitionerPL).mockResolvedValue([
      row({ practitionerId: 'p1', revenueGenerated: 500 }),
      row({ practitionerId: 'p2', revenueGenerated: 1500 }),
    ])

    const result = await listPractitionerEarnings('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result.map((r) => r.practitionerId)).toEqual(['p2', 'p1'])
  })

  it('sorts by procedureCount when requested', async () => {
    vi.mocked(getPractitionerPL).mockResolvedValue([
      row({ practitionerId: 'p1', procedureCount: 2 }),
      row({ practitionerId: 'p2', procedureCount: 8 }),
    ])

    const result = await listPractitionerEarnings('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      sort: { key: 'procedureCount', dir: 'asc' },
    })

    expect(result.map((r) => r.procedureCount)).toEqual([2, 8])
  })

  it('sorts by practitionerName alphabetically when requested', async () => {
    vi.mocked(getPractitionerPL).mockResolvedValue([
      row({ practitionerId: 'p1', practitionerName: 'Zeca' }),
      row({ practitionerId: 'p2', practitionerName: 'Ana' }),
    ])

    const result = await listPractitionerEarnings('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      sort: { key: 'practitionerName', dir: 'asc' },
    })

    expect(result.map((r) => r.practitionerName)).toEqual(['Ana', 'Zeca'])
  })

  it('caps the result at 200 rows after sorting', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      row({ practitionerId: `p${i}`, revenueGenerated: i }),
    )
    vi.mocked(getPractitionerPL).mockResolvedValue(many)

    const result = await listPractitionerEarnings('tenant-1', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    })

    expect(result).toHaveLength(200)
    // Default order is descending revenueGenerated, so the top earners survive the cap.
    expect(result[0].revenueGenerated).toBe(249)
  })
})
