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

vi.mock('@/db/queries/reports/pendencias-documentais', () => ({
  listDocumentGaps: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { listDocumentGaps } from '@/db/queries/reports/pendencias-documentais'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { DocumentGapRow } from '@/db/queries/reports/pendencias-documentais'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: DocumentGapRow[] = [
  {
    patientId: 'p1',
    fullName: 'Ana Souza',
    phone: '5511999998888',
    missing: 'consentimento',
    procedureTypeName: 'Botox',
    procedureDate: '2026-06-01',
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
  vi.mocked(listDocumentGaps).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/pendencias-documentais', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/pendencias-documentais'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listDocumentGaps).not.toHaveBeenCalled()
  })

  it('rejects an unknown sort key with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/pendencias-documentais?sort=notARealField'),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(listDocumentGaps).not.toHaveBeenCalled()
  })

  it('rejects an invalid dir with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/pendencias-documentais?sort=fullName&dir=sideways'),
    )

    expect(res.status).toBe(400)
    expect(listDocumentGaps).not.toHaveBeenCalled()
  })

  it('passes no sort to the query when the param is absent', async () => {
    await GET(makeRequest('http://localhost/api/reports/pendencias-documentais'))

    expect(listDocumentGaps).toHaveBeenCalledWith('tenant-1', { sort: undefined })
  })

  it('passes a valid sort key and dir through to the query', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/pendencias-documentais?sort=procedureDate&dir=asc'),
    )

    expect(res.status).toBe(200)
    expect(listDocumentGaps).toHaveBeenCalledWith('tenant-1', {
      sort: { key: 'procedureDate', dir: 'asc' },
    })
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/pendencias-documentais'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toEqual(SAMPLE_ROWS)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/pendencias-documentais?format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="pendencias-documentais-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Paciente')
    expect(text).toContain('Ana Souza')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/pendencias-documentais?format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="pendencias-documentais-\d{4}-\d{2}-\d{2}\.pdf"$/,
    )
    expect(renderReactToPdf).toHaveBeenCalled()
  })
})
