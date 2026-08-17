import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenantHeaderInfo: vi.fn(),
}))

vi.mock('@/db/queries/reports/procedimentos-realizados', () => ({
  listProcedureApplications: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { getTenantHeaderInfo } from '@/db/queries/tenants'
import { listProcedureApplications } from '@/db/queries/reports/procedimentos-realizados'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { ProcedureApplicationRow } from '@/db/queries/reports/procedimentos-realizados'

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: ProcedureApplicationRow[] = [
  {
    id: 'app-1',
    performedAt: new Date('2026-04-10T15:00:00Z'),
    patientName: 'Ana Souza',
    practitionerName: 'Dra. Beatriz',
    productName: 'Botox',
    activeIngredient: 'Toxina botulínica',
    totalQuantity: 20,
    quantityUnit: 'U',
    batchNumber: 'L12345',
    expirationDate: '2027-01-01',
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
  vi.mocked(getTenantHeaderInfo).mockResolvedValue({
    name: 'Clínica Teste',
    phone: '11987654321',
    email: 'contato@clinicateste.com.br',
    logoUrl: 'https://storage.example.com/tenant-1/branding/logo.png',
    address: { city: 'São Paulo', state: 'SP' },
  })
  vi.mocked(listProcedureApplications).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/procedimentos-realizados', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listProcedureApplications).not.toHaveBeenCalled()
  })


  it('rejects an invalid practitionerId with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/procedimentos-realizados?practitionerId=not-a-uuid'),
    )

    expect(res.status).toBe(400)
    expect(listProcedureApplications).not.toHaveBeenCalled()
  })

  it('rejects a malformed patientId with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/procedimentos-realizados?patientId=not-a-uuid'),
    )

    expect(res.status).toBe(400)
    expect(listProcedureApplications).not.toHaveBeenCalled()
  })

  it('filters by patientId when a valid one is given', async () => {
    const patientId = '11111111-1111-1111-1111-111111111111'
    const res = await GET(
      makeRequest(`http://localhost/api/reports/procedimentos-realizados?patientId=${patientId}`),
    )

    expect(res.status).toBe(200)
    expect(listProcedureApplications).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ patientId }),
    )
  })

  it('omits patientId (returns unfiltered results) when none is given', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados'))

    expect(res.status).toBe(200)
    expect(listProcedureApplications).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ patientId: undefined }),
    )
  })

  it('rejects an unknown sort key with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/procedimentos-realizados?sort=notARealField'),
    )

    expect(res.status).toBe(400)
    expect(listProcedureApplications).not.toHaveBeenCalled()
  })


  it('returns JSON rows with no format param', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toHaveLength(1)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/procedimentos-realizados?format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="procedimentos-realizados-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Lote')
    expect(text).toContain('L12345')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/procedimentos-realizados?format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="procedimentos-realizados-\d{4}-\d{2}-\d{2}\.pdf"$/,
    )
    expect(renderReactToPdf).toHaveBeenCalled()

    // The PDF tree gets the full tenant projection `ClinicHeader` needs
    // (name, phone, email, logoUrl, address), not just `tenants.name`.
    const element = vi.mocked(renderReactToPdf).mock.calls[0][0] as { props: { tenant: unknown } }
    expect(element.props.tenant).toEqual({
      name: 'Clínica Teste',
      phone: '11987654321',
      email: 'contato@clinicateste.com.br',
      logoUrl: 'https://storage.example.com/tenant-1/branding/logo.png',
      address: { city: 'São Paulo', state: 'SP' },
    })
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
      const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados'))

      expect(res.status).toBe(200)
      expect(listProcedureApplications).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-05-05', dateTo: '2026-08-03' }),
      )
    })

    it('completes a dateFrom-only range with today instead of rejecting it', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/procedimentos-realizados?dateFrom=2026-01-15'),
      )

      expect(res.status).toBe(200)
      expect(listProcedureApplications).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-01-15', dateTo: '2026-08-03' }),
      )
    })

    it('completes a dateTo-only range with 90 days before it', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/procedimentos-realizados?dateTo=2026-06-30'),
      )

      expect(res.status).toBe(200)
      expect(listProcedureApplications).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ dateFrom: '2026-04-01', dateTo: '2026-06-30' }),
      )
    })

    it('still rejects a malformed dateFrom with 400, even on its own', async () => {
      const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados?dateFrom=04-2026'))

      expect(res.status).toBe(400)
      expect(listProcedureApplications).not.toHaveBeenCalled()
    })

    it('still rejects a malformed dateTo with 400, even on its own', async () => {
      const res = await GET(makeRequest('http://localhost/api/reports/procedimentos-realizados?dateTo=2026-02-31'))

      expect(res.status).toBe(400)
      expect(listProcedureApplications).not.toHaveBeenCalled()
    })

    it('still rejects dateFrom after dateTo with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/procedimentos-realizados?dateFrom=2026-05-01&dateTo=2026-04-01'),
      )

      expect(res.status).toBe(400)
      expect(listProcedureApplications).not.toHaveBeenCalled()
    })
  })

})
