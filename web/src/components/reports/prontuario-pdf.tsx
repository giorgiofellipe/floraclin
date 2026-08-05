import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import { BR_TZ, toBrYmd } from '@/lib/dates'
import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import { CONSENT_TYPE_LABELS, METHOD_LABELS } from '@/lib/constants'
import { FloraclinBrandHeader } from '@/lib/pdf-branding'
// Imported from `face-template-data`, never from `face-template` itself:
// that module is `'use client'`, and this one renders on the server inside
// the `/api/reports/prontuario` route handler. See the header comment in
// `face-template-data.ts` for why the distinction is load-bearing.
import {
  VIEW_LABELS,
  VIEW_FILES,
  resolveGenderKey,
} from '@/components/face-diagram/face-template-data'
import type { ProntuarioDossier } from '@/db/queries/reports/prontuario'
import type { AnamnesisFormData } from '@/validations/anamnesis'
import type { DiagramWithPoints } from '@/db/queries/face-diagrams'

/**
 * Extra CSS for the prontuário document, layered on top of `PRINT_BASE_CSS`
 * (see `web/src/lib/pdf.ts`). Pass `${PRINT_BASE_CSS}${PRONTUARIO_PDF_CSS}`
 * as the second argument to `renderReactToPdf`. Not shared with
 * `REPORT_PDF_CSS` (the tabular reports' stylesheet): this document is
 * sectioned prose plus small tables, not one big table.
 */
export const PRONTUARIO_PDF_CSS = `
  h2.prontuario-section-title { font-size: 15px; margin: 1.75rem 0 0.5rem 0; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
  h3.prontuario-subsection-title { font-size: 13px; margin: 1rem 0 0.35rem 0; }
  .prontuario-identification { display: flex; flex-wrap: wrap; gap: 0.25rem 2rem; font-size: 13px; }
  .prontuario-identification div { min-width: 200px; }
  .prontuario-identification .label { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .prontuario-empty { font-size: 12px; color: #888; font-style: italic; }
  .prontuario-procedure { margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px dashed #ddd; }
  .prontuario-procedure .procedure-heading { font-size: 13px; font-weight: 600; }
  .prontuario-procedure .procedure-meta { font-size: 11px; color: #555; margin-top: 0.1rem; }
  table.prontuario-table { width: 100%; border-collapse: collapse; margin-top: 0.4rem; font-size: 11px; }
  table.prontuario-table th, table.prontuario-table td { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.prontuario-table th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  .prontuario-photo-grid { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem; }
  .prontuario-photo-card { width: 110px; font-size: 9px; text-align: center; color: #555; }
  .prontuario-photo-card img { width: 110px; height: 110px; object-fit: cover; border: 1px solid #ddd; }
  .prontuario-photo-counts { font-size: 11px; color: #444; margin-top: 0.5rem; }
  .prontuario-generated-at { margin-top: 2rem; font-size: 10px; color: #888; text-align: right; }
  .prontuario-tag-list { font-size: 11px; }
  .prontuario-diagram-list { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
  .prontuario-diagram-title { font-size: 11px; font-weight: 600; margin-bottom: 0.35rem; }
  .prontuario-diagram-body { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .prontuario-diagram-canvas { position: relative; width: 190px; height: 190px; flex-shrink: 0; border: 1px solid #eee; background: #fafafa; }
  .prontuario-diagram-image { width: 100%; height: 100%; object-fit: contain; }
  .prontuario-diagram-marker {
    position: absolute; transform: translate(-50%, -50%); width: 16px; height: 16px; border-radius: 50%;
    color: white; font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.4);
  }
  .prontuario-diagram-legend { flex: 1; min-width: 200px; margin-top: 0; }
  .prontuario-diagram-legend-dot {
    display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px;
    border-radius: 50%; color: white; font-size: 8px; font-weight: 700;
  }
`

function formatBrTimestamp(date: Date): string {
  return formatInTimeZone(date, BR_TZ, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/** `performedAt`/`acceptedAt` are `timestamptz` instants; converting to a BR
 *  calendar day first (rather than passing straight to `formatDate`) keeps
 *  this correct in the PDF renderer, which runs on a UTC host (see
 *  `web/src/lib/pdf.ts`), same reasoning as `PROCEDURE_APPLICATION_COLUMNS`. */
function formatInstantAsBrDate(date: Date): string {
  return formatDate(toBrYmd(date))
}

const GENDER_LABELS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Não informado',
}

const MEDICAL_HISTORY_LABELS: Record<string, string> = {
  diabetes: 'Diabetes',
  hipertensao: 'Hipertensão',
  autoimune: 'Doença autoimune',
  cardiovascular: 'Doença cardiovascular',
  hepatite: 'Hepatite',
  hiv: 'HIV',
  cancer: 'Câncer',
  epilepsia: 'Epilepsia',
  disturbioCoagulacao: 'Distúrbio de coagulação',
  queloides: 'Queloides',
  herpes: 'Herpes',
}

interface AddressShape {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
}

function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  const a = address as AddressShape
  const line1 = [a.street, a.number].filter(Boolean).join(', ')
  const line2 = [a.neighborhood, a.city, a.state].filter(Boolean).join(' - ')
  const parts = [line1, a.complement, line2, a.zip].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length > 0 ? parts.join(' · ') : null
}

interface ProntuarioPdfProps {
  clinicName: string
  dossier: ProntuarioDossier
  generatedAt: Date
}

/**
 * Printable clinical record for one patient: identification, anamnese,
 * every procedure with its product applications and face-diagram points, a
 * bounded photo timeline and the signed consent history. Rendered
 * server-side via `renderReactToPdf` from `@/lib/pdf`, same pipeline as
 * every other report and the consent PDF.
 */
export function ProntuarioPdf({ clinicName, dossier, generatedAt }: ProntuarioPdfProps) {
  const { patient, anamnesis, procedures, proceduresTruncated, photos, consents } = dossier
  const address = formatAddress(patient.address)

  return (
    <div>
      <FloraclinBrandHeader />
      <header>
        <div>
          <div className="clinic-name">{clinicName}</div>
        </div>
      </header>

      <h1>Prontuário completo</h1>
      <div className="meta-row">Documento de uso do paciente e da clínica. Não substitui laudo médico.</div>

      <h2 className="prontuario-section-title">Identificação</h2>
      <div className="prontuario-identification">
        <div>
          <div className="label">Nome</div>
          <div>{patient.fullName}</div>
        </div>
        <div>
          <div className="label">CPF</div>
          <div>{patient.cpf ?? '-'}</div>
        </div>
        <div>
          <div className="label">Data de nascimento</div>
          <div>{patient.birthDate ? formatDate(patient.birthDate) : '-'}</div>
        </div>
        <div>
          <div className="label">Gênero</div>
          <div>{patient.gender ? (GENDER_LABELS[patient.gender] ?? patient.gender) : '-'}</div>
        </div>
        <div>
          <div className="label">Telefone</div>
          <div>{formatBrPhone(patient.phone)}</div>
        </div>
        <div>
          <div className="label">E-mail</div>
          <div>{patient.email ?? '-'}</div>
        </div>
        <div>
          <div className="label">Profissão</div>
          <div>{patient.occupation ?? '-'}</div>
        </div>
        <div>
          <div className="label">Endereço</div>
          <div>{address ?? '-'}</div>
        </div>
      </div>

      <h2 className="prontuario-section-title">Anamnese</h2>
      <AnamnesisSection anamnesis={anamnesis} />

      <h2 className="prontuario-section-title">Procedimentos</h2>
      {proceduresTruncated && (
        <div className="prontuario-empty">
          Este paciente tem mais procedimentos do que os listados abaixo; exibindo apenas os mais recentes.
        </div>
      )}
      {procedures.length === 0 ? (
        <div className="prontuario-empty">Nenhum procedimento registrado.</div>
      ) : (
        procedures.map((procedure) => (
          <div className="prontuario-procedure" key={procedure.id}>
            <div className="procedure-heading">{procedure.procedureTypeName}</div>
            <div className="procedure-meta">
              {procedure.performedAt ? formatInstantAsBrDate(procedure.performedAt) : 'Sem data de realização'}
              {' · '}
              {procedure.practitionerName}
              {' · '}
              {procedure.sessionsExecuted}/{procedure.sessionsTotal} sessões
              {procedure.technique ? ` · Técnica: ${procedure.technique}` : ''}
            </div>

            {procedure.productApplications.length > 0 && (
              <table className="prontuario-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Princípio ativo</th>
                    <th>Quantidade</th>
                    <th>Lote</th>
                    <th>Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {procedure.productApplications.map((app) => (
                    <tr key={app.id}>
                      <td>{app.productName}</td>
                      <td>{app.activeIngredient ?? '-'}</td>
                      <td>{app.totalQuantity} {app.quantityUnit}</td>
                      <td>{app.batchNumber ?? '-'}</td>
                      <td>{app.expirationDate ? formatDate(app.expirationDate) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {procedure.faceDiagrams.length > 0 ? (
              <FaceDiagramSection diagrams={procedure.faceDiagrams} gender={patient.gender} />
            ) : (
              <div className="prontuario-empty">Nenhum diagrama facial registrado para este procedimento.</div>
            )}
          </div>
        ))
      )}

      <h2 className="prontuario-section-title">Fotos</h2>
      <PhotosSection photos={photos} />

      <h2 className="prontuario-section-title">Consentimentos assinados</h2>
      {consents.length === 0 ? (
        <div className="prontuario-empty">Nenhum termo assinado.</div>
      ) : (
        <table className="prontuario-table">
          <thead>
            <tr>
              <th>Termo</th>
              <th>Tipo</th>
              <th>Assinado em</th>
              <th>Método</th>
              <th>Código de verificação</th>
            </tr>
          </thead>
          <tbody>
            {consents.map((consent) => (
              <tr key={consent.id}>
                <td>{consent.templateTitle}</td>
                <td>{CONSENT_TYPE_LABELS[consent.templateType] ?? consent.templateType}</td>
                <td>{formatBrTimestamp(consent.acceptedAt)}</td>
                <td>{METHOD_LABELS[consent.acceptanceMethod] ?? consent.acceptanceMethod}</td>
                <td>{consent.verificationCode ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="prontuario-generated-at">Gerado em {formatBrTimestamp(generatedAt)}</div>
    </div>
  )
}

// Category → marker color, mirroring `getPointColor` in
// `@/components/face-diagram/diagram-point.tsx`. Duplicated rather than
// imported: that module is `'use client'` and pulls in `@/components/ui/tooltip`,
// which has no business running inside `renderReactToPdf`'s server-only,
// `renderToStaticMarkup` pass — this document's rendering is deliberately
// independent of the app's interactive UI components (see the plain
// `<table>`/`<div>` markup and dedicated `PRONTUARIO_PDF_CSS` throughout
// this file, rather than reusing Tailwind-based app components).
const POINT_COLOR_RULES: Array<{ match: RegExp; color: string }> = [
  { match: /botox|toxina|dysport|xeomin|botul[íi]nic/i, color: '#3b82f6' }, // neurotoxins
  { match: /filler|preenchedor|hialur[ôo]nic|juvederm|restylane|\bah\b/i, color: '#ec4899' }, // fillers
  { match: /bioestimulador|biostimulator|sculptra|radiesse|ellans[ée]/i, color: '#22c55e' }, // biostimulators
]

function getPointColor(productName: string): string {
  return POINT_COLOR_RULES.find((rule) => rule.match.test(productName))?.color ?? '#a855f7'
}

/**
 * Absolute URL for a face-template image (`web/public/face-templates/*.webp`,
 * the same files `FaceTemplate` renders on screen). `renderReactToPdf` gives
 * Chromium a raw HTML string via `page.setContent` with no base URL, so a
 * root-relative `VIEW_FILES` path (e.g. `/face-templates/female-front.webp`)
 * never resolves there — it needs the deployed app's own origin prefixed,
 * the same pattern `VerificationFooter` in `@/lib/pdf` already uses for
 * `NEXT_PUBLIC_APP_URL`. Reading the file off disk instead was considered
 * and rejected: Vercel/Lambda's file-tracer does not guarantee arbitrary
 * `public/` assets ship inside the serverless function bundle, so `fs`
 * would work locally and silently 404 in production.
 */
function faceTemplateUrl(viewType: string, gender: string | null | undefined): string {
  const genderKey = resolveGenderKey(gender)
  const files = VIEW_FILES[genderKey]
  const path = files[viewType as keyof typeof files] ?? files.front
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.floraclin.com.br'
  return `${appUrl}${path}`
}

/**
 * Prints the same thing the app shows in the face-diagram editor — the
 * template silhouette with each point positioned over it — instead of a
 * text list, so the printed document matches what the practitioner actually
 * drew (see `web/src/components/face-diagram/face-diagram-editor.tsx` and
 * `diagram-point.tsx` for the on-screen equivalent this mirrors). Each
 * marker is numbered rather than labeled inline (no room for a product name
 * inside a 16px circle, and static print has no hover tooltip to fall back
 * on); the legend table underneath keeps product, dose and unit — the data
 * a practitioner needs to read off this document — legible in print.
 */
function FaceDiagramSection({
  diagrams,
  gender,
}: {
  diagrams: DiagramWithPoints[]
  gender: string | null | undefined
}) {
  return (
    <div className="prontuario-diagram-list">
      {diagrams.map((diagram) => (
        <div key={diagram.id}>
          <div className="prontuario-diagram-title">
            Diagrama facial ({VIEW_LABELS[diagram.viewType as keyof typeof VIEW_LABELS] ?? diagram.viewType})
          </div>
          {diagram.points.length === 0 ? (
            <div className="prontuario-empty">Nenhum ponto marcado neste diagrama.</div>
          ) : (
            <div className="prontuario-diagram-body">
              <div className="prontuario-diagram-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={faceTemplateUrl(diagram.viewType, gender)}
                  alt={VIEW_LABELS[diagram.viewType as keyof typeof VIEW_LABELS] ?? diagram.viewType}
                  className="prontuario-diagram-image"
                />
                {diagram.points.map((point, index) => (
                  <span
                    key={point.id}
                    className="prontuario-diagram-marker"
                    style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: getPointColor(point.productName) }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
              <table className="prontuario-table prontuario-diagram-legend">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Produto</th>
                    <th>Dose</th>
                  </tr>
                </thead>
                <tbody>
                  {diagram.points.map((point, index) => (
                    <tr key={point.id}>
                      <td>
                        <span
                          className="prontuario-diagram-legend-dot"
                          style={{ backgroundColor: getPointColor(point.productName) }}
                        >
                          {index + 1}
                        </span>
                      </td>
                      <td>{point.productName}</td>
                      <td>{point.quantity} {point.quantityUnit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function AnamnesisSection({ anamnesis }: { anamnesis: ProntuarioDossier['anamnesis'] }) {
  if (!anamnesis) {
    return <div className="prontuario-empty">Anamnese não preenchida.</div>
  }

  const medicalHistory = (anamnesis.medicalHistory ?? {}) as Partial<AnamnesisFormData['medicalHistory']>
  const activeConditions = Object.entries(MEDICAL_HISTORY_LABELS)
    .filter(([key]) => medicalHistory[key as keyof Omit<AnamnesisFormData['medicalHistory'], 'outros'>])
    .map(([, label]) => label)
  if (medicalHistory.outros) activeConditions.push(medicalHistory.outros)

  const medications = (anamnesis.medications ?? []) as AnamnesisFormData['medications']
  const allergies = (anamnesis.allergies ?? []) as AnamnesisFormData['allergies']

  return (
    <div>
      {anamnesis.mainComplaint && (
        <div>
          <h3 className="prontuario-subsection-title">Queixa principal</h3>
          <div>{anamnesis.mainComplaint}</div>
        </div>
      )}
      {anamnesis.patientGoals && (
        <div>
          <h3 className="prontuario-subsection-title">Objetivos do paciente</h3>
          <div>{anamnesis.patientGoals}</div>
        </div>
      )}

      <h3 className="prontuario-subsection-title">Histórico médico</h3>
      <div className="prontuario-tag-list">
        {activeConditions.length > 0 ? activeConditions.join(', ') : 'Nenhuma condição relatada.'}
        {(anamnesis.isPregnant || anamnesis.isBreastfeeding) && (
          <div>
            {anamnesis.isPregnant ? 'Gestante. ' : ''}
            {anamnesis.isBreastfeeding ? 'Amamentando.' : ''}
          </div>
        )}
      </div>

      <h3 className="prontuario-subsection-title">Medicações em uso</h3>
      <div className="prontuario-tag-list">
        {medications.length > 0
          ? medications.map((m) => `${m.name}${m.dosage ? ` (${m.dosage})` : ''}`).join(', ')
          : 'Nenhuma medicação relatada.'}
      </div>

      <h3 className="prontuario-subsection-title">Alergias</h3>
      <div className="prontuario-tag-list">
        {allergies.length > 0
          ? allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}`).join(', ')
          : 'Nenhuma alergia relatada.'}
      </div>
    </div>
  )
}

// Every photo is embedded as a thumbnail, grouped by timeline stage and
// chronological within each stage: a prontuário handed to a patient is
// largely about the photographic record, so summarizing most of it away as
// filenames would gut the section. The `.prontuario-photo-card img` CSS
// already renders these at 110x110 (see `PRONTUARIO_PDF_CSS`), which is what
// keeps the headless-Chromium render and memory footprint bounded — not a
// cap on how many photos get embedded. `MAX_PHOTOS` below is purely a guard
// against a pathological record; it must never fire for a normal patient
// timeline. When it does, a visible note says how many photos were omitted
// so nothing is silently missing from the document.
const MAX_PHOTOS = 60

type PhotoStage = ProntuarioDossier['photos'][number]
type Photo = PhotoStage['photos'][number]

interface CappedStage {
  stage: string
  label: string
  totalInStage: number
  visible: Photo[]
}

/** Plain helper (not a component/hook, so the React Compiler doesn't apply
 *  its render-purity rules to it): walks the stages in order and hands out
 *  the shared `cap` budget stage by stage, so the running total lives in
 *  this function's own local scope instead of a variable mutated inside the
 *  component's render/JSX. */
function capPhotosPerStage(stagesWithPhotos: PhotoStage[], cap: number): CappedStage[] {
  let remaining = cap
  return stagesWithPhotos.map((stage) => {
    // `listPhotos` returns each stage's photos newest-first; sort to
    // chronological (oldest first) for the printed timeline, using
    // `takenAt` when present since it reflects when the photo was actually
    // taken rather than when it was uploaded.
    const chronological = [...stage.photos].sort(
      (a, b) => (a.takenAt ?? a.createdAt).getTime() - (b.takenAt ?? b.createdAt).getTime(),
    )
    const visible = chronological.slice(0, Math.max(0, remaining))
    remaining -= visible.length
    return { stage: stage.stage, label: stage.label, totalInStage: stage.photos.length, visible }
  })
}

function PhotosSection({ photos }: { photos: ProntuarioDossier['photos'] }) {
  const totalPhotos = photos.reduce((sum, stage) => sum + stage.photos.length, 0)

  if (totalPhotos === 0) {
    return <div className="prontuario-empty">Nenhuma foto registrada.</div>
  }

  const stagesWithPhotos = photos.filter((stage) => stage.photos.length > 0)
  const omittedCount = Math.max(0, totalPhotos - MAX_PHOTOS)
  const capped = capPhotosPerStage(stagesWithPhotos, MAX_PHOTOS)

  return (
    <div>
      {capped.map((stage) =>
        stage.visible.length === 0 ? null : (
          <div key={stage.stage}>
            <h3 className="prontuario-subsection-title">
              {stage.label} ({stage.totalInStage} foto(s))
            </h3>
            <div className="prontuario-photo-grid">
              {stage.visible.map((photo) => (
                <div className="prontuario-photo-card" key={photo.id}>
                  {photo.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.signedUrl} alt={stage.label} />
                  ) : (
                    <div>(imagem indisponível)</div>
                  )}
                  <div>{photo.takenAt ? formatInstantAsBrDate(photo.takenAt) : formatInstantAsBrDate(photo.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        ),
      )}
      <div className="prontuario-photo-counts">
        {stagesWithPhotos.map((stage) => `${stage.label}: ${stage.photos.length} foto(s)`).join(' · ')}
        {' — '}
        {totalPhotos} foto(s) no total.
      </div>
      {omittedCount > 0 && (
        <div className="prontuario-empty">
          {omittedCount} foto(s) não exibida(s) por exceder o limite de {MAX_PHOTOS} imagens neste documento.
        </div>
      )}
    </div>
  )
}
