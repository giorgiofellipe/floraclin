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

vi.mock('@/db/queries/reports/marketing', () => ({
  listMarketingReportRows: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { listMarketingReportRows } from '@/db/queries/reports/marketing'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { MarketingReportRow } from '@/db/queries/reports/marketing'
import { ForbiddenError } from '@/lib/errors'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: MarketingReportRow[] = [
  {
    key: 'ad-1',
    adLabel: 'Promo Botox',
    leads: 10,
    contacted: 6,
    scheduled: 4,
    converted: 2,
    revenue: 1200,
    conversionRate: 0.2,
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
  vi.mocked(listMarketingReportRows).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/marketing', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/marketing'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listMarketingReportRows).not.toHaveBeenCalled()
  })

  it('rejects an unknown sort key with 400', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/marketing?sort=notARealField'))

    expect(res.status).toBe(400)
    expect(listMarketingReportRows).not.toHaveBeenCalled()
  })

  it('passes well-formed dates through to the query', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/marketing?dateFrom=2026-04-01&dateTo=2026-04-30'),
    )

    expect(res.status).toBe(200)
    expect(listMarketingReportRows).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ dateFrom: '2026-04-01', dateTo: '2026-04-30' }),
    )
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/marketing?dateFrom=2026-04-01&dateTo=2026-04-30'),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toHaveLength(1)
  })

  it('returns CSV via the generic pipeline for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/marketing?dateFrom=2026-04-01&dateTo=2026-04-30&format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="marketing-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Anúncio,Leads,Contatados,Agendados,Convertidos,Receita,Taxa de conversão')
    expect(text).toContain('Promo Botox')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/marketing?dateFrom=2026-04-01&dateTo=2026-04-30&format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="marketing-\d{4}-\d{2}-\d{2}\.pdf"$/,
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
      const res = await GET(makeRequest('http://localhost/api/reports/marketing'))

      expect(res.status).toBe(200)
      expect(listMarketingReportRows).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-05-05', dateTo: '2026-08-03' }),
      )
    })

    it('still rejects dateFrom after dateTo with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/marketing?dateFrom=2026-05-01&dateTo=2026-04-01'),
      )

      expect(res.status).toBe(400)
      expect(listMarketingReportRows).not.toHaveBeenCalled()
    })
  })
})
