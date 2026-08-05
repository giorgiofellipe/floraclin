import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  tenants: { id: 'id', name: 'name' },
}))

vi.mock('@/db/queries/reports/ganhos-profissional', () => ({
  listPractitionerEarnings: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { listPractitionerEarnings } from '@/db/queries/reports/ganhos-profissional'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { PractitionerPLRow } from '@/db/queries/reports/ganhos-profissional'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: PractitionerPLRow[] = [
  {
    practitionerId: 'p1',
    practitionerName: 'Dra. Ana',
    revenueGenerated: 1000,
    revenueCollected: 800,
    procedureCount: 5,
    averageTicket: 200,
    byProcedureType: [],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireRole).mockResolvedValue({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
    email: 'owner@example.com',
    fullName: 'Owner Example',
    isPlatformAdmin: false,
  } as never)
  dbMock.limit.mockResolvedValue([{ name: 'Clínica Teste' }])
  vi.mocked(listPractitionerEarnings).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/ganhos-profissional', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listPractitionerEarnings).not.toHaveBeenCalled()
  })


  it('rejects an invalid practitionerId with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/ganhos-profissional?practitionerId=not-a-uuid'),
    )

    expect(res.status).toBe(400)
    expect(listPractitionerEarnings).not.toHaveBeenCalled()
  })

  it('rejects an unknown sort key with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/ganhos-profissional?sort=notARealField'),
    )

    expect(res.status).toBe(400)
    expect(listPractitionerEarnings).not.toHaveBeenCalled()
  })


  it('passes a valid practitionerId through', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111'
    const res = await GET(
      makeRequest(`http://localhost/api/reports/ganhos-profissional?practitionerId=${uuid}`),
    )

    expect(res.status).toBe(200)
    expect(listPractitionerEarnings).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ practitionerId: uuid }),
    )
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toEqual(SAMPLE_ROWS)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional?format=csv'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="ganhos-profissional-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Profissional')
    expect(text).toContain('Dra. Ana')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional?format=pdf'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="ganhos-profissional-\d{4}-\d{2}-\d{2}\.pdf"$/,
    )
    expect(renderReactToPdf).toHaveBeenCalled()
  })

  describe('date range', () => {
    // Fixed clock so "the last 90 days" is a concrete pair of dates in the
    // assertion rather than something recomputed from the same helpers the
    // route uses.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-03T15:00:00Z')) // BR noon on 2026-08-03
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('defaults to the last 90 days when no dates are sent', async () => {
      const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional'))

      expect(res.status).toBe(200)
      expect(listPractitionerEarnings).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-05-05', dateTo: '2026-08-03' }),
      )
    })

    it('completes a dateFrom-only range with today instead of rejecting it', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/ganhos-profissional?dateFrom=2026-01-15'),
      )

      expect(res.status).toBe(200)
      expect(listPractitionerEarnings).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-01-15', dateTo: '2026-08-03' }),
      )
    })

    it('completes a dateTo-only range with 90 days before it', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/ganhos-profissional?dateTo=2026-06-30'),
      )

      expect(res.status).toBe(200)
      expect(listPractitionerEarnings).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-04-01', dateTo: '2026-06-30' }),
      )
    })

    it('still rejects a malformed dateFrom with 400, even on its own', async () => {
      const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional?dateFrom=04-2026'))

      expect(res.status).toBe(400)
      expect(listPractitionerEarnings).not.toHaveBeenCalled()
    })

    it('still rejects a malformed dateTo with 400, even on its own', async () => {
      const res = await GET(makeRequest('http://localhost/api/reports/ganhos-profissional?dateTo=2026-02-31'))

      expect(res.status).toBe(400)
      expect(listPractitionerEarnings).not.toHaveBeenCalled()
    })

    it('still rejects dateFrom after dateTo with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/ganhos-profissional?dateFrom=2026-05-01&dateTo=2026-04-01'),
      )

      expect(res.status).toBe(400)
      expect(listPractitionerEarnings).not.toHaveBeenCalled()
    })
  })

})
