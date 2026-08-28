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

function makePhoto(
  id: string,
  overrides: {
    stage?: keyof typeof STAGE_LABELS
    createdAt?: Date
    procedureRecordId?: string | null
    procedureTypeName?: string | null
    procedurePerformedAt?: Date | null
  } = {},
) {
  return {
    id,
    storagePath: `path/${id}`,
    originalFilename: null,
    mimeType: null,
    fileSizeBytes: null,
    timelineStage: overrides.stage ?? 'pre',
    takenAt: null,
    notes: null,
    createdAt: overrides.createdAt ?? new Date(2026, 0, 1, 12, 0, 0),
    signedUrl: `https://example.com/${id}.jpg`,
    procedureRecordId: overrides.procedureRecordId ?? null,
    procedureTypeName: overrides.procedureTypeName ?? null,
    procedurePerformedAt: overrides.procedurePerformedAt ?? null,
    hasAnnotation: false,
    cropBox: null,
  }
}

/** Builds a `photos` dossier field with N photos per stage, all otherwise
 *  identical (no procedure), mirroring the shape `listPhotos` returns (all
 *  six fixed stages, only some populated). */
function photosWithCounts(counts: Partial<Record<keyof typeof STAGE_LABELS, number>>): ProntuarioDossier['photos'] {
  return Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    photos: Array.from({ length: counts[stage as keyof typeof STAGE_LABELS] ?? 0 }, (_, i) =>
      makePhoto(`${stage}-${i}`, { stage: stage as keyof typeof STAGE_LABELS, createdAt: new Date(2026, 0, i + 1, 12, 0, 0) }),
    ),
  })) as never
}

/** Buckets a flat list of photos (each already carrying its own `stage`)
 *  into the six fixed stage groups `listPhotos` always returns, the shape
 *  `PhotosSection` (and `groupPhotosByProcedure`) actually consumes. */
function bucketByStage(photos: ReturnType<typeof makePhoto>[]): ProntuarioDossier['photos'] {
  return Object.entries(STAGE_LABELS).map(([stage, label]) => ({
    stage,
    label,
    photos: photos.filter((p) => p.timelineStage === stage),
  })) as never
}

const TENANT = {
  name: 'Clínica Teste',
  phone: '11987654321',
  email: 'contato@clinicateste.com.br',
  logoUrl: null,
  address: { street: 'Rua das Flores', number: '100', city: 'São Paulo', state: 'SP' },
}

const TENANT_WITH_LOGO = {
  ...TENANT,
  logoUrl: 'https://storage.example.com/tenant-1/branding/logo.png?token=abc',
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
  it('renders the clinic header (name and logo) when logoUrl is present', () => {
    render(<ProntuarioPdf tenant={TENANT_WITH_LOGO} dossier={emptyDossier()} generatedAt={new Date('2026-08-05T12:00:00Z')} />)

    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    const logo = screen.getByRole('img', { name: 'Clínica Teste' })
    expect(logo).toHaveAttribute('src', TENANT_WITH_LOGO.logoUrl)
  })

  it('renders the clinic name without throwing when logoUrl is null', () => {
    render(<ProntuarioPdf tenant={TENANT} dossier={emptyDossier()} generatedAt={new Date('2026-08-05T12:00:00Z')} />)

    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Clínica Teste' })).not.toBeInTheDocument()
  })

  it('renders identification fields', () => {
    render(<ProntuarioPdf tenant={TENANT} dossier={emptyDossier()} generatedAt={new Date('2026-08-05T12:00:00Z')} />)

    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('123.456.789-00')).toBeInTheDocument()
    expect(screen.getByText('20/05/1990')).toBeInTheDocument()
    expect(screen.getByText('Feminino')).toBeInTheDocument()
  })

  it('renders empty-state copy for every section when the patient has no data, without throwing', () => {
    render(<ProntuarioPdf tenant={TENANT} dossier={emptyDossier()} generatedAt={new Date()} />)

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

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

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

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getAllByText('Toxina botulínica').length).toBeGreaterThan(0)
    // "Botox" appears twice: the product-applications table and the face
    // diagram's own legend table (see the dedicated face-diagram tests below).
    expect(screen.getAllByText('Botox').length).toBeGreaterThan(0)
    expect(screen.getByText('L12345')).toBeInTheDocument()
    expect(screen.getByText(/Diagrama facial \(Frontal\)/)).toBeInTheDocument()
    expect(screen.getByText(/4\.00/)).toBeInTheDocument()
  })

  describe('face diagram section', () => {
    function dossierWithDiagram(faceDiagrams: ProntuarioDossier['procedures'][number]['faceDiagrams']) {
      return emptyDossier({
        procedures: [
          {
            id: 'proc-1',
            performedAt: new Date('2026-04-10T15:00:00Z'),
            status: 'completed',
            technique: null,
            notes: null,
            sessionsTotal: 1,
            sessionsExecuted: 1,
            sessions: [],
            procedureTypeName: 'Toxina botulínica',
            procedureTypeCategory: 'toxina',
            practitionerName: 'Dra. Beatriz',
            productApplications: [],
            faceDiagrams,
          },
        ],
      })
    }

    it('renders points with product and dose, positioned on the face template image', () => {
      const dossier = dossierWithDiagram([
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
            {
              id: 'point-2',
              x: '60.00',
              y: '40.00',
              productName: 'Juvederm Voluma',
              activeIngredient: 'Ácido hialurônico',
              quantity: '1.00',
              quantityUnit: 'mL',
              technique: null,
              depth: null,
              notes: null,
              sortOrder: 1,
            },
          ],
        },
      ] as never)

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      // The template image itself, positioned via the face-templates asset.
      const images = screen.getAllByRole('img')
      expect(images.length).toBeGreaterThan(0)
      expect(images[0]).toHaveAttribute('src', expect.stringContaining('/face-templates/'))

      // Legend rows carry product + dose, the data that must stay readable in print.
      expect(screen.getByText('Botox')).toBeInTheDocument()
      expect(screen.getByText('4.00 U')).toBeInTheDocument()
      expect(screen.getByText('Juvederm Voluma')).toBeInTheDocument()
      expect(screen.getByText('1.00 mL')).toBeInTheDocument()
    })

    it('renders an empty state for a procedure with no face diagram', () => {
      const dossier = dossierWithDiagram([])

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      expect(
        screen.getByText('Nenhum diagrama facial registrado para este procedimento.'),
      ).toBeInTheDocument()
      expect(screen.queryAllByRole('img')).toHaveLength(0)
    })

    it('renders an empty state for a diagram with no points marked', () => {
      const dossier = dossierWithDiagram([
        { id: 'diag-1', viewType: 'front', points: [] },
      ] as never)

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      expect(screen.getByText('Nenhum ponto marcado neste diagrama.')).toBeInTheDocument()
      expect(screen.queryAllByRole('img')).toHaveLength(0)
    })
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

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('Termo de consentimento - Botox')).toBeInTheDocument()
    expect(screen.getByText('FLC-ABC123')).toBeInTheDocument()
  })

  it('shows a truncation notice when the procedure list was capped', () => {
    const dossier = emptyDossier({ proceduresTruncated: true })

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

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

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

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

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getByText('tipo_novo')).toBeInTheDocument()
    expect(screen.getByText('carta_registrada')).toBeInTheDocument()
  })

  it('embeds every photo across multiple stages, not just one per stage', () => {
    const dossier = emptyDossier({ photos: photosWithCounts({ pre: 8, '30d': 3 }) })

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

    expect(screen.getAllByRole('img')).toHaveLength(11)
    // No procedure on any of these photos, so everything lands in the
    // single "Sem procedimento vinculado" group.
    expect(screen.getByText('Sem procedimento vinculado (11 foto(s))')).toBeInTheDocument()
  })

  it('does not show an omission note when the photo count is under the per-procedure cap', () => {
    const dossier = emptyDossier({ photos: photosWithCounts({ pre: 3, '30d': 2 }) })

    render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

    expect(screen.queryByText(/não exibida/)).not.toBeInTheDocument()
  })

  describe('photo grouping by procedure', () => {
    const PROC_A = 'proc-a' // newer
    const PROC_B = 'proc-b' // older

    it('groups photos under their procedure heading, newest procedure first', () => {
      const dossier = emptyDossier({
        photos: bucketByStage([
          makePhoto('a-1', {
            stage: 'pre',
            procedureRecordId: PROC_A,
            procedureTypeName: 'Botox',
            procedurePerformedAt: new Date('2026-06-01T12:00:00Z'),
          }),
          makePhoto('b-1', {
            stage: 'pre',
            procedureRecordId: PROC_B,
            procedureTypeName: 'Preenchimento',
            procedurePerformedAt: new Date('2026-01-01T12:00:00Z'),
          }),
        ]),
      })

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
      const botoxIndex = headings.findIndex((t) => t?.startsWith('Botox'))
      const preenchimentoIndex = headings.findIndex((t) => t?.startsWith('Preenchimento'))
      expect(botoxIndex).toBeGreaterThanOrEqual(0)
      expect(preenchimentoIndex).toBeGreaterThanOrEqual(0)
      expect(botoxIndex).toBeLessThan(preenchimentoIndex)
    })

    it('does not pool photos from unrelated procedures under one stage heading', () => {
      const dossier = emptyDossier({
        photos: bucketByStage([
          makePhoto('a-1', { stage: 'pre', procedureRecordId: PROC_A, procedureTypeName: 'Botox', procedurePerformedAt: new Date('2026-06-01T12:00:00Z') }),
          makePhoto('b-1', { stage: 'pre', procedureRecordId: PROC_B, procedureTypeName: 'Preenchimento', procedurePerformedAt: new Date('2026-01-01T12:00:00Z') }),
        ]),
      })

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      // Each procedure gets its own "(1 foto(s))" group, not a shared "Pré" heading.
      expect(screen.getByText(/Botox.*\(1 foto\(s\)\)/)).toBeInTheDocument()
      expect(screen.getByText(/Preenchimento.*\(1 foto\(s\)\)/)).toBeInTheDocument()
      expect(screen.queryByText(/^Pré \(/)).not.toBeInTheDocument()
    })

    it('orders photos within a procedure by clinical timeline stage, and labels each with its stage', () => {
      const dossier = emptyDossier({
        photos: bucketByStage([
          makePhoto('p-90d', { stage: '90d', procedureRecordId: PROC_A, procedureTypeName: 'Botox', procedurePerformedAt: new Date('2026-06-01T12:00:00Z') }),
          makePhoto('p-pre', { stage: 'pre', procedureRecordId: PROC_A, procedureTypeName: 'Botox', procedurePerformedAt: new Date('2026-06-01T12:00:00Z') }),
          makePhoto('p-7d', { stage: '7d', procedureRecordId: PROC_A, procedureTypeName: 'Botox', procedurePerformedAt: new Date('2026-06-01T12:00:00Z') }),
        ]),
      })

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      const images = screen.getAllByRole('img')
      expect(images.map((img) => img.getAttribute('alt'))).toEqual(['Pré', '7 Dias', '90 Dias'])
    })

    it('puts photos with no procedureRecordId in a final "Sem procedimento vinculado" group', () => {
      const dossier = emptyDossier({
        photos: bucketByStage([
          makePhoto('linked-1', { stage: 'pre', procedureRecordId: PROC_A, procedureTypeName: 'Botox', procedurePerformedAt: new Date('2026-01-01T12:00:00Z') }),
          makePhoto('avulsa-1', { stage: 'pre' }),
        ]),
      })

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '')
      const botoxIndex = headings.findIndex((t) => t.startsWith('Botox'))
      const unlinkedIndex = headings.findIndex((t) => t.startsWith('Sem procedimento vinculado'))
      expect(botoxIndex).toBeGreaterThanOrEqual(0)
      expect(unlinkedIndex).toBe(headings.length - 1)
      expect(botoxIndex).toBeLessThan(unlinkedIndex)
    })

    it('caps each procedure at its own budget so one procedure with many photos does not starve another', () => {
      const busyProcedurePhotos = Array.from({ length: 15 }, (_, i) =>
        makePhoto(`busy-${i}`, {
          stage: 'pre',
          createdAt: new Date(2026, 0, i + 1, 12, 0, 0),
          procedureRecordId: PROC_A,
          procedureTypeName: 'Botox',
          procedurePerformedAt: new Date('2026-06-01T12:00:00Z'),
        }),
      )
      const otherProcedurePhotos = Array.from({ length: 3 }, (_, i) =>
        makePhoto(`quiet-${i}`, {
          stage: 'pre',
          createdAt: new Date(2026, 1, i + 1, 12, 0, 0),
          procedureRecordId: PROC_B,
          procedureTypeName: 'Preenchimento',
          procedurePerformedAt: new Date('2026-01-01T12:00:00Z'),
        }),
      )

      const dossier = emptyDossier({
        photos: bucketByStage([...busyProcedurePhotos, ...otherProcedurePhotos]),
      })

      render(<ProntuarioPdf tenant={TENANT} dossier={dossier} generatedAt={new Date()} />)

      // 12 from the busy procedure (capped) + all 3 from the quiet one:
      // the quiet procedure is not starved by the busy one's overflow.
      expect(screen.getAllByRole('img')).toHaveLength(15)
      expect(screen.getByText(/Botox.*\(15 foto\(s\)\)/)).toBeInTheDocument()
      expect(screen.getByText(/Preenchimento.*\(3 foto\(s\)\)/)).toBeInTheDocument()
      expect(screen.getByText(/3 foto\(s\) não exibida\(s\) por exceder o limite de 12 imagens por procedimento/)).toBeInTheDocument()
    })
  })
})
