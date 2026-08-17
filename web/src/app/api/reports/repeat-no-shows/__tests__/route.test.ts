import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/db/queries/tenants', () => ({
  getTenantHeaderInfo: vi.fn(),
}))

vi.mock('@/db/queries/reports/repeat-no-shows', () => ({
  listRepeatNoShows: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { getTenantHeaderInfo } from '@/db/queries/tenants'
import { listRepeatNoShows } from '@/db/queries/reports/repeat-no-shows'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { RepeatNoShowRow } from '@/db/queries/reports/repeat-no-shows'

function makeRequest(url: string) {
  return new Request(url)
}

const SAMPLE_ROWS: RepeatNoShowRow[] = [
  {
    patientId: 'p1',
    fullName: 'Ana Souza',
    phone: '5511999998888',
    missedCount: 3,
    dates: ['2026-06-01', '2026-05-01', '2026-07-01'],
    missedValue: 1500,
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
  vi.mocked(listRepeatNoShows).mockResolvedValue(SAMPLE_ROWS)
})

describe('GET /api/reports/repeat-no-shows', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest('http://localhost/api/reports/repeat-no-shows'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric window with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?windowDays=abc'),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects a negative window with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?windowDays=-5'),
    )

    expect(res.status).toBe(400)
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects an absurdly large window (> 3650) with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?windowDays=99999'),
    )

    expect(res.status).toBe(400)
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric minCount with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?minCount=abc'),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects a negative minCount with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?minCount=-1'),
    )

    expect(res.status).toBe(400)
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('rejects an absurdly large minCount (> 1000) with 400', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?minCount=99999'),
    )

    expect(res.status).toBe(400)
    expect(listRepeatNoShows).not.toHaveBeenCalled()
  })

  it('accepts well-formed filters and passes them through', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?windowDays=90&minCount=3'),
    )

    expect(res.status).toBe(200)
    expect(listRepeatNoShows).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ windowDays: 90, minCount: 3 }),
    )
  })

  it('defaults windowDays to 180 and minCount to 2 when absent', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/repeat-no-shows'))

    expect(res.status).toBe(200)
    expect(listRepeatNoShows).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ windowDays: 180, minCount: 2 }),
    )
  })

  it('passes `today` as a Date instance built at the route boundary', async () => {
    await GET(makeRequest('http://localhost/api/reports/repeat-no-shows'))

    const args = vi.mocked(listRepeatNoShows).mock.calls[0][1]
    expect(args.today).toBeInstanceOf(Date)
  })

  it('returns JSON rows with no format param', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/repeat-no-shows'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data).toEqual(SAMPLE_ROWS)
  })

  it('returns CSV with the right content type and Content-Disposition for format=csv', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?format=csv'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="faltas-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const text = await res.text()
    expect(text).toContain('Paciente')
    expect(text).toContain('Ana Souza')
  })

  it('returns PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/reports/repeat-no-shows?format=pdf'),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="faltas-\d{4}-\d{2}-\d{2}\.pdf"$/,
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

  describe('sort', () => {
    it('rejects an unknown sort key with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/repeat-no-shows?sort=notARealField'),
      )
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toBeTruthy()
      expect(listRepeatNoShows).not.toHaveBeenCalled()
    })

    it('rejects an invalid dir with 400', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/repeat-no-shows?sort=missedCount&dir=sideways'),
      )

      expect(res.status).toBe(400)
      expect(listRepeatNoShows).not.toHaveBeenCalled()
    })

    it('passes no sort to the query when the param is absent', async () => {
      await GET(makeRequest('http://localhost/api/reports/repeat-no-shows'))

      expect(listRepeatNoShows).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ sort: undefined }),
      )
    })

    it('passes a valid sort key and dir through to the query', async () => {
      const res = await GET(
        makeRequest('http://localhost/api/reports/repeat-no-shows?sort=missedValue&dir=asc'),
      )

      expect(res.status).toBe(200)
      expect(listRepeatNoShows).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ sort: { key: 'missedValue', dir: 'asc' } }),
      )
    })
  })
})
