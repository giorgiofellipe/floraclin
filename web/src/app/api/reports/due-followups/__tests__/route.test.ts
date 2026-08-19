import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/db/queries/reports/due-followups', () => ({
  listDueFollowUps: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { listDueFollowUps } from '@/db/queries/reports/due-followups'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { DueFollowUpRow } from '@/db/queries/reports/due-followups'
import { ForbiddenError } from '@/lib/errors'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: DueFollowUpRow[] = [
  {
    patientId: 'p1',
    fullName: 'Ana Souza',
    phone: '5511999998888',
    followUpDate: '2026-08-10',
    daysUntil: 7,
    isOverdue: false,
    procedureTypeName: 'Botox',
    lastProcedureAt: '2026-05-10',
  },
  {
    patientId: 'p2',
    fullName: 'Bruno Lima',
    phone: '5511988887777',
    followUpDate: '2026-07-20',
    daysUntil: -14,
    isOverdue: true,
    procedureTypeName: 'Preenchimento',
    lastProcedureAt: '2026-04-20',
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
  vi.mocked(listDueFollowUps).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/due-followups', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new ForbiddenError('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/due-followups'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listDueFollowUps).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric window with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=abc'),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(listDueFollowUps).not.toHaveBeenCalled()
  })

  it('rejects a negative window with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=-5'),
    )

    expect(res.status).toBe(400)
    expect(listDueFollowUps).not.toHaveBeenCalled()
  })

  it('rejects an absurdly large window (> 3650) with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=99999'),
    )

    expect(res.status).toBe(400)
    expect(listDueFollowUps).not.toHaveBeenCalled()
  })

  it('accepts a well-formed window and passes it through', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=60'),
    )

    expect(res.status).toBe(200)
    expect(listDueFollowUps).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ windowDays: 60 }),
    )
  })

  it('defaults the window to 30 days when absent', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/due-followups'))

    expect(res.status).toBe(200)
    expect(listDueFollowUps).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ windowDays: 30 }),
    )
  })

  it('passes `today` as a Date instance built at the route boundary', async () => {
    await GET(makeRequest('http://localhost/api/reports/due-followups?windowDays=60'))

    const args = vi.mocked(listDueFollowUps).mock.calls[0][1]
    expect(args.today).toBeInstanceOf(Date)
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=60'),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toEqual(SAMPLE_ROWS)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=60&format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="retornos-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Paciente')
    expect(text).toContain('Ana Souza')
    expect(text).toContain('Vencido há 14 dias')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/due-followups?windowDays=60&format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="retornos-\d{4}-\d{2}-\d{2}\.pdf"$/,
    )
    expect(renderReactToPdf).toHaveBeenCalled()
  })

  describe('sort', () => {
    it('rejects an unknown sort key with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/due-followups?sort=notARealField'),
      )
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toBeTruthy()
      expect(listDueFollowUps).not.toHaveBeenCalled()
    })

    it('rejects an invalid dir with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/due-followups?sort=daysUntil&dir=sideways'),
      )

      expect(res.status).toBe(400)
      expect(listDueFollowUps).not.toHaveBeenCalled()
    })

    it('passes no sort to the query when the param is absent', async () => {
      await GET(makeRequest('http://localhost/api/reports/due-followups'))

      expect(listDueFollowUps).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ sort: undefined }),
      )
    })

    it('passes a valid sort key and dir through to the query', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/due-followups?sort=followUpDate&dir=desc'),
      )

      expect(res.status).toBe(200)
      expect(listDueFollowUps).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ sort: { key: 'followUpDate', dir: 'desc' } }),
      )
    })
  })
})
