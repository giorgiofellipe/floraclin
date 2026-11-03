import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import { BR_TZ, toBrYmd } from '@/lib/dates'
import { formatDate } from '@/lib/utils'
import { formatBrPhone } from '@/lib/phone'
import { CONSENT_TYPE_LABELS, METHOD_LABELS, GENDER_LABELS } from '@/lib/constants'
import { FloraclinBrandHeader } from '@/lib/pdf-branding'
import { ClinicHeader, toClinicHeaderTenant } from '@/components/print/clinic-header'
import type { TenantHeaderInfo } from '@/lib/tenant-header'
import { timelineStageValues, timelineStageLabels } from '@/validations/photo'
import { FaceDiagramPdfSection, DIAGRAM_PDF_CSS } from '@/components/face-diagram/diagram-pdf'
import type { ProntuarioDossier } from '@/db/queries/reports/prontuario'
import { isQuestionAnswered } from '@/lib/forms/answers'
import type { FormListResponse, FormQuestion, FormResponseValue } from '@/lib/forms/types'
import { ListAnswerTable } from '@/components/forms/list-answer-table'

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
  .prontuario-answer { font-size: 12px; margin: 0.2rem 0; }
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
${DIAGRAM_PDF_CSS}`

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
  /**
   * Raw tenant projection (`getTenantHeaderInfoForPdf`, `@/db/queries/tenants`).
   * `toClinicHeaderTenant` narrows its free-form JSONB `address` for the header.
   */
  tenant: TenantHeaderInfo
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
export function ProntuarioPdf({ tenant, dossier, generatedAt }: ProntuarioPdfProps) {
  const { patient, anamnesis, procedures, proceduresTruncated, photos, consents } = dossier
  const address = formatAddress(patient.address)

  return (
    <div>
      {/* FloraClin stays as a small mark above the clinic's own header: this
          document is handed to the PATIENT, so the clinic's identity leads.
          The per-page footer (`renderReactToPdf` / `buildFloraclinFooterTemplate`)
          already carries the durable "made with FloraClin" provenance line,
          so this header mark is optional branding, not the provenance
          record; see the module doc on `FloraclinBrandHeader` in
          `@/lib/pdf-branding`. */}
      <FloraclinBrandHeader />
      <ClinicHeader tenant={toClinicHeaderTenant(tenant)} />

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
              <FaceDiagramPdfSection diagrams={procedure.faceDiagrams} gender={patient.gender} />
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

function formatAnswerText(question: FormQuestion, value: FormResponseValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'number') {
    return question.scaleMax !== undefined ? `${value} / ${question.scaleMax}` : String(value)
  }
  if (value && typeof value === 'object' && 'other' in value) {
    const selected = Array.isArray(value.selected) ? value.selected : [value.selected]
    return [...selected, value.other].filter(Boolean).join(', ')
  }
  return typeof value === 'string' ? value : ''
}

function AnamnesisSection({ anamnesis }: { anamnesis: ProntuarioDossier['anamnesis'] }) {
  if (!anamnesis) return <div className="prontuario-empty">Anamnese não preenchida.</div>
  const blocks = [...anamnesis.templateSnapshot]
    .sort((a, b) => a.order - b.order)
    .flatMap((section) => {
      const answered = [...section.questions]
        .sort((a, b) => a.order - b.order)
        .filter((q) => isQuestionAnswered(q, anamnesis.responses[q.id]))
      if (answered.length === 0) return []
      return [
        <div key={section.id}>
          <h3 className="prontuario-subsection-title">{section.title}</h3>
          {answered.map((q) =>
            q.type === 'list' ? (
              <div key={q.id} className="prontuario-answer">
                <strong>{q.label}</strong>
                <ListAnswerTable
                  question={q}
                  rows={anamnesis.responses[q.id] as FormListResponse}
                  className="prontuario-table"
                />
              </div>
            ) : (
              <div key={q.id} className="prontuario-answer">
                <strong>{/[?:]$/.test(q.label) ? q.label : `${q.label}:`}</strong> {formatAnswerText(q, anamnesis.responses[q.id])}
              </div>
            ),
          )}
        </div>,
      ]
    })
  if (blocks.length === 0) return <div className="prontuario-empty">Anamnese sem respostas registradas.</div>
  return <div>{blocks}</div>
}

// Every photo is embedded as a thumbnail, grouped by PROCEDURE, newest
// procedure first, matching the on-screen grouping in
// `@/components/photos/photo-grid.tsx` (`procedureGroups`, keyed by
// `photo.procedureRecordId`), not the timeline stage this section used to
// group by. Grouping by stage alone pooled photos from procedures months
// apart under one heading (the wrong story for a clinical document) and
// separated a procedure's photos from the procedure entry this same PDF
// already lists above under "Procedimentos". Within a procedure, photos are
// ordered by clinical timeline stage (pré, pós imediato, 7d, 30d, 90d,
// outro) and each card is labeled with its stage, since a group can now mix
// stages. Photos with no `procedureRecordId` ("fotos avulsas") land in one
// final "Sem procedimento vinculado" group, after every real procedure.
//
// `MAX_PHOTOS_PER_PROCEDURE` bounds embedded images PER GROUP instead of a
// single flat budget for the whole document: a flat budget meant one
// procedure with a burst of uploads could exhaust it and starve every later
// procedure's photos entirely. 12 covers two photos across each of the six
// stages, generous for any real procedure, while still bounding a
// pathological one; a visible note in Portuguese says how many were omitted
// whenever a group's own photos exceed it.
const MAX_PHOTOS_PER_PROCEDURE = 12

type PhotoStage = ProntuarioDossier['photos'][number]
type Photo = PhotoStage['photos'][number]
type StagedPhoto = Photo & { stage: string }

// Fixed clinical order for stages within a procedure group: the same order
// `listPhotos` (`@/db/queries/photos.ts`) already buckets `dossier.photos`
// in, reused here rather than re-declared so the two can't drift.
const STAGE_ORDER: readonly string[] = timelineStageValues

interface PhotoGroup {
  key: string
  procedureRecordId: string | null
  procedureTypeName: string | null
  procedurePerformedAt: Date | null
  photos: StagedPhoto[]
}

interface CappedGroup extends Omit<PhotoGroup, 'photos'> {
  totalInGroup: number
  visible: StagedPhoto[]
  omitted: number
}

/** Groups every photo across all stage buckets by the procedure it belongs
 *  to, newest procedure first (`procedurePerformedAt` descending), with an
 *  unlinked ("avulsas") group always last regardless of date. This mirrors
 *  `photo-grid.tsx`'s grouping but with the unlinked bucket pinned to the
 *  end rather than sorted in by its own timestamp, per this section's own
 *  presentation order. Plain helper (not a component/hook) so the React
 *  Compiler doesn't apply render-purity rules meant for JSX-returning
 *  functions to it. */
function groupPhotosByProcedure(stagesWithPhotos: PhotoStage[]): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>()
  const UNLINKED_KEY = '__unlinked__'

  // Sort defensively into clinical stage order rather than trusting the
  // caller's array order, then traverse stage-major: appending each stage's
  // photos to their procedure's group in that order gives every group's
  // `photos` array the right within-procedure stage order for free, without
  // a second sort.
  const orderedStages = [...stagesWithPhotos].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
  )
  for (const stage of orderedStages) {
    for (const photo of stage.photos) {
      const key = photo.procedureRecordId ?? UNLINKED_KEY
      let group = groups.get(key)
      if (!group) {
        group = {
          key,
          procedureRecordId: photo.procedureRecordId,
          procedureTypeName: photo.procedureTypeName,
          procedurePerformedAt: photo.procedurePerformedAt,
          photos: [],
        }
        groups.set(key, group)
      }
      group.photos.push({ ...photo, stage: stage.stage })
    }
  }

  const linked = [...groups.values()].filter((g) => g.procedureRecordId !== null)
  linked.sort((a, b) => {
    const aTime = a.procedurePerformedAt?.getTime() ?? -Infinity
    const bTime = b.procedurePerformedAt?.getTime() ?? -Infinity
    return bTime - aTime
  })

  const unlinked = groups.get(UNLINKED_KEY)
  return unlinked ? [...linked, unlinked] : linked
}

/** Caps each group independently at `capPerGroup`, keeping the earliest
 *  photos in clinical-stage order (same "oldest/most-baseline first" bias
 *  the old flat cap used) and reporting how many of that group's own photos
 *  were left out. */
function capPhotoGroups(groups: PhotoGroup[], capPerGroup: number): CappedGroup[] {
  return groups.map(({ photos, ...group }) => {
    const visible = photos.slice(0, capPerGroup)
    return {
      ...group,
      totalInGroup: photos.length,
      visible,
      omitted: Math.max(0, photos.length - capPerGroup),
    }
  })
}

function photoGroupHeading(group: CappedGroup): string {
  if (!group.procedureRecordId) return 'Sem procedimento vinculado'
  const name = group.procedureTypeName ?? 'Procedimento'
  return group.procedurePerformedAt ? `${name} (${formatInstantAsBrDate(group.procedurePerformedAt)})` : name
}

function PhotosSection({ photos }: { photos: ProntuarioDossier['photos'] }) {
  const totalPhotos = photos.reduce((sum, stage) => sum + stage.photos.length, 0)

  if (totalPhotos === 0) {
    return <div className="prontuario-empty">Nenhuma foto registrada.</div>
  }

  const stagesWithPhotos = photos.filter((stage) => stage.photos.length > 0)
  const groups = groupPhotosByProcedure(stagesWithPhotos)
  const capped = capPhotoGroups(groups, MAX_PHOTOS_PER_PROCEDURE)
  const totalOmitted = capped.reduce((sum, group) => sum + group.omitted, 0)

  return (
    <div>
      {capped.map((group) => (
        <div key={group.key}>
          <h3 className="prontuario-subsection-title">
            {photoGroupHeading(group)} ({group.totalInGroup} foto(s))
          </h3>
          <div className="prontuario-photo-grid">
            {group.visible.map((photo) => (
              <div className="prontuario-photo-card" key={photo.id}>
                {photo.signedUrl ? (
                  <img src={photo.signedUrl} alt={timelineStageLabels[photo.stage as keyof typeof timelineStageLabels] ?? photo.stage} />
                ) : (
                  <div>(imagem indisponível)</div>
                )}
                <div>{timelineStageLabels[photo.stage as keyof typeof timelineStageLabels] ?? photo.stage}</div>
                <div>{photo.takenAt ? formatInstantAsBrDate(photo.takenAt) : formatInstantAsBrDate(photo.createdAt)}</div>
              </div>
            ))}
          </div>
          {group.omitted > 0 && (
            <div className="prontuario-empty">
              {group.omitted} foto(s) não exibida(s) por exceder o limite de {MAX_PHOTOS_PER_PROCEDURE} imagens por procedimento neste documento.
            </div>
          )}
        </div>
      ))}
      <div className="prontuario-photo-counts">
        {capped.map((group) => `${photoGroupHeading(group)}: ${group.totalInGroup} foto(s)`).join(' · ')}
        {' — '}
        {totalPhotos} foto(s) no total.
      </div>
      {totalOmitted > 0 && (
        <div className="prontuario-empty">
          {totalOmitted} foto(s) não exibida(s) no total por exceder o limite por procedimento.
        </div>
      )}
    </div>
  )
}
