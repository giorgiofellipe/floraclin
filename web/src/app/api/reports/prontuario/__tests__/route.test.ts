import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('@/db/queries/reports/prontuario', () => ({
  getPatientDossier: vi.fn(),
  toProntuarioSummary: vi.fn(),
}))

vi.mock('@/lib/pdf', () => ({
  renderReactToPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  PRINT_BASE_CSS: '',
}))

// ─── Imports (after mocks) ───────────────────────────────────────────

import { requireRole } from '@/lib/auth'
import { db } from '@/db/client'
import { getPatientDossier, toProntuarioSummary } from '@/db/queries/reports/prontuario'
import { renderReactToPdf } from '@/lib/pdf'
import { GET } from '../route'
import type { ProntuarioDossier } from '@/db/queries/reports/prontuario'

const dbMock = db as unknown as { limit: ReturnType<typeof vi.fn> }

function makeRequest(url: string) {
  return new Request(url)
}

const VALID_PATIENT_ID = '11111111-1111-1111-1111-111111111111'

const SAMPLE_DOSSIER: ProntuarioDossier = {
  patient: {
    id: VALID_PATIENT_ID,
    tenantId: 'tenant-1',
    responsibleUserId: null,
    fullName: 'Ana Souza',
    cpf: null,
    birthDate: null,
    gender: null,
    email: null,
    phone: '11987654321',
    phoneSecondary: null,
    address: null,
    occupation: null,
    referralSource: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never,
  anamnesis: null,
  procedures: [],
  proceduresTruncated: false,
  photos: [],
  consents: [],
}

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
  vi.mocked(getPatientDossier).mockResolvedValue(SAMPLE_DOSSIER)
  // A minimal passthrough is enough for these route-wiring tests; the real
  // projection's behavior (what it strips, what it keeps) is covered by the
  // dedicated tests in `db/queries/reports/__tests__/prontuario.test.ts`,
  // which call `toProntuarioSummary` directly without needing this route's
  // heavier mock setup.
  vi.mocked(toProntuarioSummary).mockImplementation((dossier) => ({
    patient: { fullName: dossier.patient.fullName, phone: dossier.patient.phone, cpf: null, birthDate: null, gender: null, email: null },
    anamnesis: null,
    procedures: [],
    proceduresTruncated: false,
    photos: [],
    consents: [],
  }))
})

describe('GET /api/reports/prontuario', () => {
  it('returns 403 for a practitioner', async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('Forbidden: insufficient permissions'))

    const res = await GET(makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}`))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toBeTruthy()
    expect(getPatientDossier).not.toHaveBeenCalled()
  })

  it('returns 400 when patientId is missing entirely, and never fetches every patient', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/prontuario'))

    expect(res.status).toBe(400)
    expect(getPatientDossier).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed patientId', async () => {
    const res = await GET(makeRequest('http://localhost/api/reports/prontuario?patientId=not-a-uuid'))

    expect(res.status).toBe(400)
    expect(getPatientDossier).not.toHaveBeenCalled()
  })

  it('returns 400 for format=csv without ever loading the dossier', async () => {
    const res = await GET(
      makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}&format=csv`),
    )

    expect(res.status).toBe(400)
    expect(getPatientDossier).not.toHaveBeenCalled()
  })

  it('returns 404 when the patient does not exist in this tenant', async () => {
    vi.mocked(getPatientDossier).mockResolvedValue(null)

    const res = await GET(makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}`))

    expect(res.status).toBe(404)
  })

  it('calls getPatientDossier with the authenticated tenantId and the requested patientId', async () => {
    const res = await GET(makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}`))

    expect(res.status).toBe(200)
    expect(getPatientDossier).toHaveBeenCalledWith('tenant-1', VALID_PATIENT_ID)
  })

  it('returns JSON with the right content type when no format is given', async () => {
    const res = await GET(makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(json.data.patient.fullName).toBe('Ana Souza')
  })

  it('projects the JSON branch through toProntuarioSummary instead of returning the raw dossier', async () => {
    // A sentinel the passthrough mock above would never itself produce,
    // so this only passes if the route's response body IS what
    // `toProntuarioSummary` returned, not the raw `dossier` object (which
    // carries every consent's signature data and every photo's signed URL).
    const projected = { __projected: true }
    vi.mocked(toProntuarioSummary).mockReturnValue(projected as never)

    const res = await GET(makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(toProntuarioSummary).toHaveBeenCalledWith(SAMPLE_DOSSIER)
    expect(json.data).toEqual(projected)
    expect(json.data).not.toHaveProperty('consents')
  })

  it('still renders the PDF branch from the full dossier, not the JSON summary', async () => {
    const res = await GET(
      makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}&format=pdf`),
    )

    expect(res.status).toBe(200)
    // `toProntuarioSummary` is JSON-branch-only; the PDF branch must never
    // call it, or the PDF would silently lose everything the summary drops
    // (signatures, photos, face-diagram points).
    expect(toProntuarioSummary).not.toHaveBeenCalled()
    expect(renderReactToPdf).toHaveBeenCalled()
  })

  it('returns a PDF with the right content type and Content-Disposition for format=pdf', async () => {
    const res = await GET(
      makeRequest(`http://localhost/api/reports/prontuario?patientId=${VALID_PATIENT_ID}&format=pdf`),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="prontuario-.*\.pdf"$/)
    expect(renderReactToPdf).toHaveBeenCalled()
  })
})
