import { getPatient, type Patient } from '@/db/queries/patients'
import { getAnamnesis } from '@/db/queries/anamnesis'
import { listProcedures, type ProcedureListItem, type ProcedureSessionSummary } from '@/db/queries/procedures'
import { getProductApplications, type ProductApplicationRecord } from '@/db/queries/product-applications'
import { getFaceDiagram, type DiagramWithPoints } from '@/db/queries/face-diagrams'
import { listPhotos, type PhotosByStage } from '@/db/queries/photos'
import { getConsentHistory } from '@/db/queries/consent'

/**
 * "Prontuário completo" (report 3.1): a single patient's full clinical
 * history, composed entirely from existing tenant+patient-scoped query
 * functions rather than one new giant join. Every sub-query below already
 * filters by `tenantId` (see each module), and the two record-scoped calls
 * (`getProductApplications`, `getFaceDiagram`) only ever receive a
 * `procedureRecordId` that came out of `listProcedures(tenantId, patientId)`,
 * so they can never reach across into another patient's or tenant's rows.
 *
 * `getPatient` is the single gate: it returns `null` for a patient that
 * doesn't exist OR belongs to a different tenant, and this function returns
 * `null` right there without touching any other table — a wrong or
 * cross-tenant `patientId` never gets far enough to leak a fragment of
 * clinical data.
 */

// A patient with an unbounded procedure history could make this document
// (and the render time / memory of the headless-Chromium PDF pass) grow
// without limit. 100 mirrors the precedent set by the other traceability
// report (`listProcedureApplications`'s MAX_ROWS), and is far beyond what
// any real aesthetic-clinic patient accumulates.
const MAX_PROCEDURES = 100

// `getAnamnesis`'s own return statement is `result[0] ?? null`, but with
// `noUncheckedIndexedAccess` off (this project's default), TypeScript treats
// `result[0]` as non-nullable and therefore drops the `?? null` branch from
// the *inferred* return type entirely — `Awaited<ReturnType<...>>` alone
// resolves to the row type only, not `Row | null`. The `| null` here is
// added back explicitly so this type matches what the function actually
// returns at runtime (verified: a patient with no anamnese row).
export type AnamnesisRecord = Awaited<ReturnType<typeof getAnamnesis>> | null
export type ConsentHistoryEntry = Awaited<ReturnType<typeof getConsentHistory>>[number]

export interface ProntuarioProcedure {
  id: string
  performedAt: Date | null
  status: string
  technique: string | null
  notes: string | null
  sessionsTotal: number
  sessionsExecuted: number
  sessions: ProcedureSessionSummary[]
  procedureTypeName: string
  procedureTypeCategory: string
  practitionerName: string
  productApplications: ProductApplicationRecord[]
  faceDiagrams: DiagramWithPoints[]
}

export interface ProntuarioDossier {
  patient: Patient
  anamnesis: AnamnesisRecord
  procedures: ProntuarioProcedure[]
  /** `true` when `procedures` was truncated to `MAX_PROCEDURES`, so the PDF
   *  can say so instead of silently presenting a partial history as complete. */
  proceduresTruncated: boolean
  photos: PhotosByStage[]
  consents: ConsentHistoryEntry[]
}

/**
 * The subset of `ProntuarioDossier` the on-screen summary
 * (`web/src/app/(platform)/relatorios/prontuario/page.tsx`) actually reads:
 * patient identification, an anamnese presence check, the last few
 * procedures' name/date/practitioner, and photo/consent *counts*. See
 * `toProntuarioSummary` below for why this exists as its own shape rather
 * than reusing `ProntuarioDossier` for the JSON branch of the route.
 */
export interface ProntuarioSummary {
  patient: {
    fullName: string
    phone: string
    cpf: string | null
    birthDate: string | null
    gender: string | null
    email: string | null
  }
  anamnesis: { mainComplaint: string | null } | null
  procedures: Array<{
    id: string
    procedureTypeName: string
    performedAt: Date | null
    practitionerName: string
    productApplications: unknown[]
  }>
  proceduresTruncated: boolean
  photos: Array<{ stage: string; label: string; photos: unknown[] }>
  consents: Array<{ id: string; templateTitle: string; acceptedAt: Date }>
}

/**
 * Projects a full `ProntuarioDossier` down to `ProntuarioSummary`, which is
 * what the JSON branch of `/api/reports/prontuario` returns. The PDF branch keeps
 * using the full dossier server-side; this projection exists ONLY because
 * the JSON branch used to hand the browser the entire dossier as-is, which
 * meant every consent's base64 `signatureData`, `contentSnapshot`,
 * `signatureEvidence` and `professionalSnapshot`, every photo's storage
 * `signedUrl`, and every face-diagram point set shipped to the client even
 * though the summary page only ever renders counters and a handful of
 * procedure lines.
 *
 * `procedures[].productApplications` and `photos[].photos` are kept as
 * (empty / id-only) arrays rather than dropped, matching the page's own
 * `ProntuarioSummary` type shape 1:1, but only their *length* is ever read
 * there (e.g. `data.photos.reduce((sum, stage) => sum + stage.photos.length, 0)`),
 * so no actual photo or product-application content needs to travel over
 * the wire to preserve that.
 */
export function toProntuarioSummary(dossier: ProntuarioDossier): ProntuarioSummary {
  const { patient, anamnesis, procedures, proceduresTruncated, photos, consents } = dossier

  return {
    patient: {
      fullName: patient.fullName,
      phone: patient.phone,
      cpf: patient.cpf,
      birthDate: patient.birthDate,
      gender: patient.gender,
      email: patient.email,
    },
    anamnesis: anamnesis ? { mainComplaint: anamnesis.mainComplaint } : null,
    procedures: procedures.map((procedure) => ({
      id: procedure.id,
      procedureTypeName: procedure.procedureTypeName,
      performedAt: procedure.performedAt,
      practitionerName: procedure.practitionerName,
      productApplications: [],
    })),
    proceduresTruncated,
    photos: photos.map((stage) => ({
      stage: stage.stage,
      label: stage.label,
      photos: stage.photos.map((photo) => ({ id: photo.id })),
    })),
    consents: consents.map((consent) => ({
      id: consent.id,
      templateTitle: consent.templateTitle,
      acceptedAt: consent.acceptedAt,
    })),
  }
}

function toProntuarioProcedure(
  record: ProcedureListItem,
  productApplications: ProductApplicationRecord[],
  faceDiagrams: DiagramWithPoints[],
): ProntuarioProcedure {
  return {
    id: record.id,
    performedAt: record.performedAt,
    status: record.status,
    technique: record.technique,
    notes: record.notes,
    sessionsTotal: record.sessionsTotal,
    sessionsExecuted: record.sessionsExecuted,
    sessions: record.sessions,
    procedureTypeName: record.procedureTypeName,
    procedureTypeCategory: record.procedureTypeCategory,
    practitionerName: record.practitionerName,
    productApplications,
    faceDiagrams,
  }
}

/**
 * Loads everything the "Prontuário completo" PDF needs for one patient:
 * identification, anamnese, every procedure with its product applications
 * and face-diagram points, the photo timeline (grouped by stage) and the
 * signed consent history. Returns `null` when the patient doesn't exist in
 * this tenant, which the route turns into a 404 rather than an empty
 * document.
 */
export async function getPatientDossier(
  tenantId: string,
  patientId: string,
): Promise<ProntuarioDossier | null> {
  const patient = await getPatient(tenantId, patientId)
  if (!patient) return null

  const [anamnesis, procedureRecords, photos, consents] = await Promise.all([
    getAnamnesis(tenantId, patientId),
    listProcedures(tenantId, patientId),
    listPhotos(tenantId, patientId),
    getConsentHistory(tenantId, patientId),
  ])

  const proceduresTruncated = procedureRecords.length > MAX_PROCEDURES
  const boundedRecords = procedureRecords.slice(0, MAX_PROCEDURES)

  const procedures = await Promise.all(
    boundedRecords.map(async (record) => {
      const [productApplications, faceDiagrams] = await Promise.all([
        getProductApplications(tenantId, record.id),
        getFaceDiagram(tenantId, record.id),
      ])
      return toProntuarioProcedure(record, productApplications, faceDiagrams)
    }),
  )

  return { patient, anamnesis, procedures, proceduresTruncated, photos, consents }
}
