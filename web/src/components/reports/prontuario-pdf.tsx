import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import { BR_TZ, toBrYmd } from '@/lib/dates'
import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import type { ProntuarioDossier } from '@/db/queries/reports/prontuario'
import type { AnamnesisFormData } from '@/validations/anamnesis'

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

            {procedure.faceDiagrams.length > 0 &&
              procedure.faceDiagrams.map((diagram) => (
                <div key={diagram.id} className="prontuario-tag-list">
                  <strong>Diagrama facial ({diagram.viewType}):</strong>{' '}
                  {diagram.points.length === 0
                    ? 'sem pontos marcados'
                    : diagram.points
                        .map((point) => `${point.productName} (${point.quantity} ${point.quantityUnit})`)
                        .join(', ')}
                </div>
              ))}
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
                <td>{consent.templateType}</td>
                <td>{formatBrTimestamp(consent.acceptedAt)}</td>
                <td>{consent.acceptanceMethod}</td>
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

// Photos are referenced, not fully embedded: a patient's full-resolution
// timeline can run into dozens of images, and embedding every one would
// slow the headless-Chromium render and risk the function's memory limit
// (see AGENTS.md guidance to bound PDF work). Instead, this shows ONE
// thumbnail per timeline stage — the most recent photo in that stage, since
// `listPhotos` already returns each stage's photos newest-first — capped at
// the 6 fixed stages, plus a full textual count/date list underneath so no
// photo is silently missing from the document, only from the visual grid.
function PhotosSection({ photos }: { photos: ProntuarioDossier['photos'] }) {
  const totalPhotos = photos.reduce((sum, stage) => sum + stage.photos.length, 0)

  if (totalPhotos === 0) {
    return <div className="prontuario-empty">Nenhuma foto registrada.</div>
  }

  const representative = photos.filter((stage) => stage.photos.length > 0)

  return (
    <div>
      <div className="prontuario-photo-grid">
        {representative.map((stage) => {
          const photo = stage.photos[0]
          return (
            <div className="prontuario-photo-card" key={stage.stage}>
              {photo.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.signedUrl} alt={stage.label} />
              ) : (
                <div>(imagem indisponível)</div>
              )}
              <div>{stage.label}</div>
              <div>{photo.takenAt ? formatInstantAsBrDate(photo.takenAt) : formatInstantAsBrDate(photo.createdAt)}</div>
            </div>
          )
        })}
      </div>
      <div className="prontuario-photo-counts">
        {photos
          .filter((stage) => stage.photos.length > 0)
          .map((stage) => `${stage.label}: ${stage.photos.length} foto(s)`)
          .join(' · ')}
        {' — '}
        {totalPhotos} foto(s) no total.
      </div>
    </div>
  )
}
