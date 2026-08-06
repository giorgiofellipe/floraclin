import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/queries/patients', () => ({
  getPatient: vi.fn(),
}))

vi.mock('@/db/queries/anamnesis', () => ({
  getAnamnesis: vi.fn(),
}))

vi.mock('@/db/queries/procedures', () => ({
  listProcedures: vi.fn(),
}))

vi.mock('@/db/queries/product-applications', () => ({
  getProductApplications: vi.fn(),
}))

vi.mock('@/db/queries/face-diagrams', () => ({
  getFaceDiagram: vi.fn(),
}))

vi.mock('@/db/queries/photos', () => ({
  listPhotos: vi.fn(),
}))

vi.mock('@/db/queries/consent', () => ({
  getConsentHistory: vi.fn(),
}))

import { getPatient } from '@/db/queries/patients'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { listProcedures } from '@/db/queries/procedures'
import { getProductApplications } from '@/db/queries/product-applications'
import { getFaceDiagram } from '@/db/queries/face-diagrams'
import { listPhotos } from '@/db/queries/photos'
import { getConsentHistory } from '@/db/queries/consent'
import { getPatientDossier, toProntuarioSummary, type ProntuarioDossier } from '../prontuario'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const PATIENT_ID = 'patient-1'

const PATIENT = { id: PATIENT_ID, tenantId: TENANT_A, fullName: 'Ana Souza' } as never

const EMPTY_PHOTOS_BY_STAGE = [
  { stage: 'pre', label: 'Pré', photos: [] },
  { stage: 'immediate_post', label: 'Pós Imediato', photos: [] },
  { stage: '7d', label: '7 Dias', photos: [] },
  { stage: '30d', label: '30 Dias', photos: [] },
  { stage: '90d', label: '90 Dias', photos: [] },
  { stage: 'other', label: 'Outro', photos: [] },
] as never

function procedureRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proc-1',
    performedAt: new Date('2026-04-10T15:00:00Z'),
    status: 'completed',
    technique: 'Técnica X',
    notes: null,
    sessionsTotal: 1,
    sessionsExecuted: 1,
    sessions: [],
    procedureTypeName: 'Botox',
    procedureTypeCategory: 'toxina',
    practitionerName: 'Dra. Beatriz',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // `getAnamnesis`'s own inferred return type drops the `| null` its `result[0]
  // ?? null` body actually returns (see the comment on `AnamnesisRecord` in
  // `../prontuario.ts`); `as never` sidesteps that quirk here rather than
  // changing the real function's signature as a side effect of this test.
  vi.mocked(getAnamnesis).mockResolvedValue(null as never)
  vi.mocked(listProcedures).mockResolvedValue([])
  vi.mocked(listPhotos).mockResolvedValue(EMPTY_PHOTOS_BY_STAGE)
  vi.mocked(getConsentHistory).mockResolvedValue([])
  vi.mocked(getProductApplications).mockResolvedValue([])
  vi.mocked(getFaceDiagram).mockResolvedValue([])
})

describe('getPatientDossier', () => {
  it('returns null, and touches no other table, when the patient does not belong to this tenant', async () => {
    vi.mocked(getPatient).mockResolvedValue(null)

    const result = await getPatientDossier(TENANT_B, PATIENT_ID)

    expect(result).toBeNull()
    expect(getAnamnesis).not.toHaveBeenCalled()
    expect(listProcedures).not.toHaveBeenCalled()
    expect(listPhotos).not.toHaveBeenCalled()
    expect(getConsentHistory).not.toHaveBeenCalled()
  })

  it('scopes every sub-query by the same tenantId and patientId used to look up the patient', async () => {
    vi.mocked(getPatient).mockResolvedValue(PATIENT)

    await getPatientDossier(TENANT_A, PATIENT_ID)

    expect(getPatient).toHaveBeenCalledWith(TENANT_A, PATIENT_ID)
    expect(getAnamnesis).toHaveBeenCalledWith(TENANT_A, PATIENT_ID)
    expect(listProcedures).toHaveBeenCalledWith(TENANT_A, PATIENT_ID)
    expect(listPhotos).toHaveBeenCalledWith(TENANT_A, PATIENT_ID)
    expect(getConsentHistory).toHaveBeenCalledWith(TENANT_A, PATIENT_ID)
  })

  it('never leaks another tenant into the record-scoped lookups: product applications and face diagrams are always fetched with the SAME tenantId used to resolve the patient', async () => {
    vi.mocked(getPatient).mockResolvedValue(PATIENT)
    vi.mocked(listProcedures).mockResolvedValue([
      procedureRecord({ id: 'proc-1' }),
      procedureRecord({ id: 'proc-2' }),
    ] as never)

    await getPatientDossier(TENANT_A, PATIENT_ID)

    expect(getProductApplications).toHaveBeenCalledWith(TENANT_A, 'proc-1')
    expect(getProductApplications).toHaveBeenCalledWith(TENANT_A, 'proc-2')
    expect(getFaceDiagram).toHaveBeenCalledWith(TENANT_A, 'proc-1')
    expect(getFaceDiagram).toHaveBeenCalledWith(TENANT_A, 'proc-2')
    // Never called with any tenant other than the one the patient was
    // resolved under, and never for a record id the patient's own
    // procedure list didn't return.
    for (const call of vi.mocked(getProductApplications).mock.calls) {
      expect(call[0]).toBe(TENANT_A)
    }
    for (const call of vi.mocked(getFaceDiagram).mock.calls) {
      expect(call[0]).toBe(TENANT_A)
    }
  })

  it('resolves without throwing for a patient with no anamnese, no procedures, no photos and no consents', async () => {
    vi.mocked(getPatient).mockResolvedValue(PATIENT)

    const result = await getPatientDossier(TENANT_A, PATIENT_ID)

    expect(result).not.toBeNull()
    expect(result?.anamnesis).toBeNull()
    expect(result?.procedures).toEqual([])
    expect(result?.photos).toEqual(EMPTY_PHOTOS_BY_STAGE)
    expect(result?.consents).toEqual([])
    expect(result?.proceduresTruncated).toBe(false)
  })

  it('attaches product applications and face diagrams to the matching procedure', async () => {
    vi.mocked(getPatient).mockResolvedValue(PATIENT)
    vi.mocked(listProcedures).mockResolvedValue([procedureRecord({ id: 'proc-1' })] as never)
    vi.mocked(getProductApplications).mockResolvedValue([
      { id: 'app-1', productName: 'Botox', activeIngredient: null, totalQuantity: '20.00', quantityUnit: 'U', batchNumber: 'L1', expirationDate: '2027-01-01', labelPhotoId: null, applicationAreas: null, notes: null },
    ] as never)
    vi.mocked(getFaceDiagram).mockResolvedValue([
      { id: 'diag-1', viewType: 'front', points: [] },
    ] as never)

    const result = await getPatientDossier(TENANT_A, PATIENT_ID)

    expect(result?.procedures).toHaveLength(1)
    expect(result?.procedures[0].productApplications).toHaveLength(1)
    expect(result?.procedures[0].productApplications[0].batchNumber).toBe('L1')
    expect(result?.procedures[0].faceDiagrams).toHaveLength(1)
  })

  it('caps procedures at 100 and flags the dossier as truncated', async () => {
    vi.mocked(getPatient).mockResolvedValue(PATIENT)
    const many = Array.from({ length: 130 }, (_, i) => procedureRecord({ id: `proc-${i}` }))
    vi.mocked(listProcedures).mockResolvedValue(many as never)

    const result = await getPatientDossier(TENANT_A, PATIENT_ID)

    expect(result?.procedures).toHaveLength(100)
    expect(result?.proceduresTruncated).toBe(true)
  })
})

describe('toProntuarioSummary', () => {
  function fullDossier(): ProntuarioDossier {
    return {
      patient: {
        id: PATIENT_ID,
        tenantId: TENANT_A,
        responsibleUserId: null,
        fullName: 'Ana Souza',
        cpf: '123.456.789-00',
        birthDate: '1990-05-20',
        gender: 'feminino',
        email: 'ana@example.com',
        phone: '11987654321',
        phoneSecondary: null,
        address: null,
        occupation: null,
        referralSource: null,
        notes: 'Notas internas sensíveis',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as never,
      anamnesis: {
        id: 'an-1',
        tenantId: TENANT_A,
        patientId: PATIENT_ID,
        mainComplaint: 'Rugas de expressão',
        patientGoals: 'Objetivos sensíveis do paciente',
      } as never,
      procedures: [
        {
          id: 'proc-1',
          performedAt: new Date('2026-04-10T15:00:00Z'),
          status: 'completed',
          technique: 'Técnica X',
          notes: null,
          sessionsTotal: 1,
          sessionsExecuted: 1,
          sessions: [],
          procedureTypeName: 'Botox',
          procedureTypeCategory: 'toxina',
          practitionerName: 'Dra. Beatriz',
          productApplications: [
            { id: 'app-1', productName: 'Botox', activeIngredient: null, totalQuantity: '20.00', quantityUnit: 'U', batchNumber: 'L1', expirationDate: '2027-01-01', labelPhotoId: null, applicationAreas: null, notes: null },
          ],
          faceDiagrams: [
            { id: 'diag-1', viewType: 'front', points: [{ id: 'point-1', x: '10.00', y: '20.00', productName: 'Botox', quantity: '4.00', quantityUnit: 'U' }] },
          ],
        },
      ] as never,
      proceduresTruncated: false,
      photos: [
        {
          stage: 'pre',
          label: 'Pré',
          photos: [
            { id: 'photo-1', signedUrl: 'https://storage.example.com/signed/photo-1.jpg', storagePath: 'a/b', createdAt: new Date(), takenAt: null, timelineStage: 'pre', procedureRecordId: null, procedureTypeName: null, procedurePerformedAt: null, hasAnnotation: false, cropBox: null, originalFilename: null, mimeType: null, fileSizeBytes: null, notes: null },
          ],
        },
        { stage: 'immediate_post', label: 'Pós Imediato', photos: [] },
        { stage: '7d', label: '7 Dias', photos: [] },
        { stage: '30d', label: '30 Dias', photos: [] },
        { stage: '90d', label: '90 Dias', photos: [] },
        { stage: 'other', label: 'Outro', photos: [] },
      ] as never,
      consents: [
        {
          id: 'consent-1',
          acceptanceMethod: 'signature',
          signatureData: 'data:image/png;base64,AAAAsensitivesignaturebytes',
          contentHash: 'hash',
          contentSnapshot: 'Texto completo do termo, sensível',
          verificationCode: 'FLC-ABC123',
          signatureEvidence: { ip: '1.2.3.4', userAgent: 'sensitive-ua' },
          professionalSnapshot: { fullName: 'Dra. Beatriz', registryNumber: 'CRM-123' },
          acceptedAt: new Date('2026-03-01T13:00:00Z'),
          procedureRecordId: null,
          templateTitle: 'Termo de consentimento - Botox',
          templateType: 'botox',
          templateVersion: 1,
        },
      ] as never,
    }
  }

  it('keeps identification, anamnese presence and procedure/consent counts', () => {
    const summary = toProntuarioSummary(fullDossier())

    expect(summary.patient.fullName).toBe('Ana Souza')
    expect(summary.anamnesis).toEqual({ mainComplaint: 'Rugas de expressão' })
    expect(summary.procedures).toHaveLength(1)
    expect(summary.procedures[0].procedureTypeName).toBe('Botox')
    expect(summary.consents).toHaveLength(1)
    expect(summary.consents[0].templateTitle).toBe('Termo de consentimento - Botox')
    // Preserves the length the summary page sums for its "Fotos" counter.
    expect(summary.photos.find((s) => s.stage === 'pre')?.photos).toHaveLength(1)
  })

  it('strips every field the summary page does not render, including all consent and photo secrets', () => {
    const summary = toProntuarioSummary(fullDossier())
    const serialized = JSON.stringify(summary)

    // Patient notes are never rendered by the summary page.
    expect(serialized).not.toContain('Notas internas sensíveis')
    expect(serialized).not.toContain('Objetivos sensíveis do paciente')

    // Consent secrets.
    expect(serialized).not.toContain('signatureData')
    expect(serialized).not.toContain('base64')
    expect(serialized).not.toContain('contentSnapshot')
    expect(serialized).not.toContain('Texto completo do termo')
    expect(serialized).not.toContain('signatureEvidence')
    expect(serialized).not.toContain('sensitive-ua')
    expect(serialized).not.toContain('professionalSnapshot')
    expect(serialized).not.toContain('CRM-123')

    // Photo storage/signing details and face-diagram points.
    expect(serialized).not.toContain('signedUrl')
    expect(serialized).not.toContain('storage.example.com')
    expect(serialized).not.toContain('storagePath')
    expect(serialized).not.toContain('faceDiagrams')
    expect(serialized).not.toContain('point-1')

    // Product application detail (batch numbers etc.) is dropped too.
    expect(serialized).not.toContain('L1')
  })
})
