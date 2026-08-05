import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProntuarioPdf } from '../prontuario-pdf'
import type { ProntuarioDossier } from '@/db/queries/reports/prontuario'

const BASE_PATIENT = {
  id: 'patient-1',
  tenantId: 'tenant-1',
  responsibleUserId: null,
  fullName: 'Ana Souza',
  cpf: '123.456.789-00',
  birthDate: '1990-05-20',
  gender: 'feminino',
  email: 'ana@example.com',
  phone: '11987654321',
  phoneSecondary: null,
  address: { street: 'Rua das Flores', number: '100', city: 'São Paulo', state: 'SP' },
  occupation: 'Designer',
  referralSource: null,
  notes: null,
  createdAt: new Date('2025-01-01T12:00:00Z'),
  updatedAt: new Date('2025-01-01T12:00:00Z'),
  deletedAt: null,
} as never

const EMPTY_PHOTOS = [
  { stage: 'pre', label: 'Pré', photos: [] },
  { stage: 'immediate_post', label: 'Pós Imediato', photos: [] },
  { stage: '7d', label: '7 Dias', photos: [] },
  { stage: '30d', label: '30 Dias', photos: [] },
  { stage: '90d', label: '90 Dias', photos: [] },
  { stage: 'other', label: 'Outro', photos: [] },
] as never

const STAGE_LABELS: Record<string, string> = {
  pre: 'Pré',
  immediate_post: 'Pós Imediato',
  '7d': '7 Dias',
  '30d': '30 Dias',
  '90d': '90 Dias',
  other: 'Outro',
}

function makePhoto(id: string, createdAt: Date) {
  return {
    id,
    storagePath: `path/${id}`,
    originalFilename: null,
    mimeType: null,
    fileSizeBytes: null,
    timelineStage: null,
    takenAt: null,
    notes: null,
    createdAt,
    signedUrl: `https://example.com/${id}.jpg`,
    procedureRecordId: null,
    procedureTypeName: null,
    procedurePerformedAt: null,
    hasAnnotation: false,
    cropBox: null,
  }
}

/** Builds a `photos` dossier field with N photos per stage, mirroring the
 *  shape `listPhotos` returns (all six fixed stages, only some populated). */
function photosWithCounts(counts: Partial<Record<keyof typeof STAGE_LABELS, number>>): ProntuarioDossier['photos'] {
  return Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    photos: Array.from({ length: counts[stage] ?? 0 }, (_, i) =>
      makePhoto(`${stage}-${i}`, new Date(2026, 0, i + 1, 12, 0, 0)),
    ),
  })) as never
}

function emptyDossier(overrides: Partial<ProntuarioDossier> = {}): ProntuarioDossier {
  return {
    patient: BASE_PATIENT,
    anamnesis: null,
    procedures: [],
    proceduresTruncated: false,
    photos: EMPTY_PHOTOS,
    consents: [],
    ...overrides,
  }
}

describe('ProntuarioPdf', () => {
  it('renders identification fields', () => {
    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={emptyDossier()} generatedAt={new Date('2026-08-05T12:00:00Z')} />)

    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('123.456.789-00')).toBeInTheDocument()
    expect(screen.getByText('20/05/1990')).toBeInTheDocument()
    expect(screen.getByText('Feminino')).toBeInTheDocument()
  })

  it('renders empty-state copy for every section when the patient has no data, without throwing', () => {
    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={emptyDossier()} generatedAt={new Date()} />)

    expect(screen.getByText('Anamnese não preenchida.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum procedimento registrado.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma foto registrada.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum termo assinado.')).toBeInTheDocument()
  })

  it('renders the anamnese summary when present', () => {
    const dossier = emptyDossier({
      anamnesis: {
        id: 'an-1',
        tenantId: 'tenant-1',
        patientId: 'patient-1',
        mainComplaint: 'Rugas de expressão',
        patientGoals: 'Rejuvenescimento',
        medicalHistory: { diabetes: true, outros: 'Enxaqueca crônica' },
        medications: [{ name: 'Losartana', dosage: '50mg', frequency: '', reason: '' }],
        allergies: [{ substance: 'Dipirona', reaction: 'Urticária' }],
        previousSurgeries: [],
        chronicConditions: [],
        isPregnant: false,
        isBreastfeeding: false,
        lifestyle: {},
        skinType: null,
        skinConditions: [],
        skincareRoutine: [],
        previousAestheticTreatments: [],
        contraindications: [],
        facialEvaluationNotes: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
    })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('Rugas de expressão')).toBeInTheDocument()
    expect(screen.getByText('Rejuvenescimento')).toBeInTheDocument()
    expect(screen.getByText(/Diabetes/)).toBeInTheDocument()
    expect(screen.getByText(/Enxaqueca crônica/)).toBeInTheDocument()
    expect(screen.getByText(/Losartana/)).toBeInTheDocument()
    expect(screen.getByText(/Dipirona/)).toBeInTheDocument()
  })

  it('renders a procedure with its product applications and face diagram points', () => {
    const dossier = emptyDossier({
      procedures: [
        {
          id: 'proc-1',
          performedAt: new Date('2026-04-10T15:00:00Z'),
          status: 'completed',
          technique: 'Técnica de leque',
          notes: null,
          sessionsTotal: 1,
          sessionsExecuted: 1,
          sessions: [],
          procedureTypeName: 'Toxina botulínica',
          procedureTypeCategory: 'toxina',
          practitionerName: 'Dra. Beatriz',
          productApplications: [
            {
              id: 'app-1',
              productName: 'Botox',
              activeIngredient: 'Toxina botulínica',
              totalQuantity: '20.00',
              quantityUnit: 'U',
              batchNumber: 'L12345',
              expirationDate: '2027-01-01',
              labelPhotoId: null,
              applicationAreas: null,
              notes: null,
            },
          ],
          faceDiagrams: [
            {
              id: 'diag-1',
              viewType: 'front',
              points: [
                {
                  id: 'point-1',
                  x: '10.00',
                  y: '20.00',
                  productName: 'Botox',
                  activeIngredient: null,
                  quantity: '4.00',
                  quantityUnit: 'U',
                  technique: null,
                  depth: null,
                  notes: null,
                  sortOrder: 0,
                },
              ],
            },
          ],
        },
      ],
    })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getAllByText('Toxina botulínica').length).toBeGreaterThan(0)
    expect(screen.getByText('Botox')).toBeInTheDocument()
    expect(screen.getByText('L12345')).toBeInTheDocument()
    expect(screen.getByText(/Diagrama facial \(Frontal\)/)).toBeInTheDocument()
    expect(screen.getByText(/4\.00 U/)).toBeInTheDocument()
  })

  it('renders signed consents', () => {
    const dossier = emptyDossier({
      consents: [
        {
          id: 'consent-1',
          acceptanceMethod: 'signature',
          signatureData: null,
          contentHash: 'hash',
          contentSnapshot: 'texto',
          verificationCode: 'FLC-ABC123',
          signatureEvidence: null,
          professionalSnapshot: null,
          acceptedAt: new Date('2026-03-01T13:00:00Z'),
          procedureRecordId: null,
          templateTitle: 'Termo de consentimento - Botox',
          templateType: 'botox',
          templateVersion: 1,
        },
      ] as never,
    })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('Termo de consentimento - Botox')).toBeInTheDocument()
    expect(screen.getByText('FLC-ABC123')).toBeInTheDocument()
  })

  it('shows a truncation notice when the procedure list was capped', () => {
    const dossier = emptyDossier({ proceduresTruncated: true })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText(/mais procedimentos do que os listados/)).toBeInTheDocument()
  })

  it('renders translated consent type and acceptance method labels, not the raw values', () => {
    const dossier = emptyDossier({
      consents: [
        {
          id: 'consent-1',
          acceptanceMethod: 'signature',
          signatureData: null,
          contentHash: 'hash',
          contentSnapshot: 'texto',
          verificationCode: 'FLC-ABC123',
          signatureEvidence: null,
          professionalSnapshot: null,
          acceptedAt: new Date('2026-03-01T13:00:00Z'),
          procedureRecordId: null,
          templateTitle: 'Termo de consentimento - Botox',
          templateType: 'botox',
          templateVersion: 1,
        },
      ] as never,
    })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('Toxina Botulínica')).toBeInTheDocument()
    expect(screen.getByText('Assinatura')).toBeInTheDocument()
    expect(screen.queryByText('botox')).not.toBeInTheDocument()
    expect(screen.queryByText('signature')).not.toBeInTheDocument()
  })

  it('falls back to the raw value for an unknown consent type or acceptance method', () => {
    const dossier = emptyDossier({
      consents: [
        {
          id: 'consent-2',
          acceptanceMethod: 'carta_registrada',
          signatureData: null,
          contentHash: 'hash',
          contentSnapshot: 'texto',
          verificationCode: null,
          signatureEvidence: null,
          professionalSnapshot: null,
          acceptedAt: new Date('2026-03-01T13:00:00Z'),
          procedureRecordId: null,
          templateTitle: 'Termo pouco comum',
          templateType: 'tipo_novo',
          templateVersion: 1,
        },
      ] as never,
    })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('tipo_novo')).toBeInTheDocument()
    expect(screen.getByText('carta_registrada')).toBeInTheDocument()
  })

  it('embeds every photo across multiple stages, not just one per stage', () => {
    const dossier = emptyDossier({ photos: photosWithCounts({ pre: 8, '30d': 3 }) })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getAllByRole('img')).toHaveLength(11)
    expect(screen.getByText('Pré (8 foto(s))')).toBeInTheDocument()
    expect(screen.getByText('30 Dias (3 foto(s))')).toBeInTheDocument()
  })

  it('caps embedded photos at 60 and shows an omission note when the record exceeds it', () => {
    const dossier = emptyDossier({ photos: photosWithCounts({ pre: 40, '30d': 25 }) })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getAllByRole('img')).toHaveLength(60)
    expect(screen.getByText(/5 foto\(s\) não exibida\(s\)/)).toBeInTheDocument()
  })

  it('does not show an omission note when the photo count is under the cap', () => {
    const dossier = emptyDossier({ photos: photosWithCounts({ pre: 3, '30d': 2 }) })

    render(<ProntuarioPdf clinicName="Clínica Teste" dossier={dossier} generatedAt={new Date()} />)

    expect(screen.queryByText(/não exibida/)).not.toBeInTheDocument()
  })
})
