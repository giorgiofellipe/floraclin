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
    expect(screen.getByText(/Diagrama facial/)).toBeInTheDocument()
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
})
