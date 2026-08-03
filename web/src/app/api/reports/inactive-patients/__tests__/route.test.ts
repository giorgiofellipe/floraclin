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
  tenants: { id: 'id', name: 'name', settings: 'settings' },
}))

vi.mock('@/db/queries/reports/inactive-patients', () => ({
  listInactivePatients: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { listInactivePatients } from '@/db/queries/reports/inactive-patients'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { InactivePatientRow } from '@/db/queries/reports/inactive-patients'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: InactivePatientRow[] = [
  {
    patientId: 'p1',
    fullName: 'Ana Souza',
    phone: '5511999998888',
    lastProcedureAt: '2026-01-01',
    daysSince: 200,
    lastProcedureType: 'Botox',
    lifetimeValue: 3500,
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
  vi.mocked(listInactivePatients).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/inactive-patients', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/inactive-patients'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listInactivePatients).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric threshold with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=abc'),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(listInactivePatients).not.toHaveBeenCalled()
  })

  it('rejects a negative threshold with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=-5'),
    )

    expect(res.status).toBe(400)
    expect(listInactivePatients).not.toHaveBeenCalled()
  })

  it('rejects an absurdly large threshold (> 3650) with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=99999'),
    )

    expect(res.status).toBe(400)
    expect(listInactivePatients).not.toHaveBeenCalled()
  })

  it('accepts a well-formed threshold and passes it through', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=60'),
    )

    expect(res.status).toBe(200)
    expect(listInactivePatients).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ thresholdDays: 60 }),
    )
  })

  it('defaults the threshold to the registry value (180) when no param is sent', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/inactive-patients'))

    expect(res.status).toBe(200)
    expect(listInactivePatients).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ thresholdDays: 180 }),
    )
  })

  it('defaults the threshold to 180 when the param is present but blank', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays='),
    )

    expect(res.status).toBe(200)
    expect(listInactivePatients).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ thresholdDays: 180 }),
    )
  })

  it('passes `today` as a Date instance built at the route boundary', async () => {
    await GET(makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=60'))

    const args = vi.mocked(listInactivePatients).mock.calls[0][1]
    expect(args.today).toBeInstanceOf(Date)
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=60'),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toEqual(SAMPLE_ROWS)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=60&format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="pacientes-inativos-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Paciente')
    expect(text).toContain('Ana Souza')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/inactive-patients?thresholdDays=60&format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="pacientes-inativos-\d{4}-\d{2}-\d{2}\.pdf"$/,
    )
    expect(renderReactToPdf).toHaveBeenCalled()
  })
})
