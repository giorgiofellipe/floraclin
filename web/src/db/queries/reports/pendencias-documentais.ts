import { db } from '@/db/client'
import { patients, anamneses, procedureRecords, procedureTypes, consentAcceptances } from '@/db/schema'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { toBrYmd } from '@/lib/dates'
import { directionalCompare, type SortDirection } from '@/lib/reports/sort'

/** What a row is missing. `'both'` covers a patient with no anamnese row at
 *  all AND at least one performed procedure with no signed consent. */
export type DocumentGapMissing = 'anamnese' | 'consentimento' | 'both'

export interface DocumentGapRow {
  patientId: string
  fullName: string
  phone: string
  missing: DocumentGapMissing
  /** Only set when `missing` includes a consent gap: the most recently
   *  performed procedure among this patient's unsigned ones. `null` for a
   *  patient whose only gap is a missing anamnese. */
  procedureTypeName: string | null
  /** BR calendar day (`YYYY-MM-DD`) the procedure above was performed,
   *  derived from its `performed_at` instant via `toBrYmd`. `null` under the
   *  same condition as `procedureTypeName`. */
  procedureDate: string | null
}

/** Server-recognized sort keys for this report. The route validates an
 *  incoming `sort` query param against this same list before it ever reaches
 *  this function. */
export type DocumentGapSortKey = 'fullName' | 'procedureDate'

export interface ListDocumentGapsOptions {
  /** Explicit sort requested by the caller. When absent, rows keep the
   *  default order: most recent compliance gap first. */
  sort?: { key: DocumentGapSortKey; dir: SortDirection }
}

const SORT_ACCESSORS: Record<DocumentGapSortKey, (row: DocumentGapRow) => string | number | null> = {
  fullName: (row) => row.fullName,
  procedureDate: (row) => row.procedureDate,
}

/** Report results are capped at this many rows, matching the precedent in
 *  `web/src/db/queries/followups.ts` and every other report query. Applied
 *  after sorting so the cap keeps the freshest gaps, not an arbitrary
 *  DB-order slice. */
const MAX_ROWS = 200

/**
 * Compliance/work-list report: patients missing a completed anamnese or a
 * signed consent for a procedure they already had performed.
 *
 * "Completed anamnese" is represented by row **presence**, not a status
 * column: `anamneses` has no `status`/`completed_at` field (every clinical
 * column is nullable), and nowhere else in the app distinguishes a partial
 * anamnese from a finished one: `patients.anamnesis: one(anamneses)`
 * already treats "has a row" as "has an anamnese" everywhere it's read. A
 * patient is therefore missing their anamnese when no row in `anamneses`
 * references their `patient_id` at all.
 *
 * "Signed consent" is represented by `consent_acceptances` row presence tied
 * to the procedure via its `procedure_record_id` FK. `accepted_at` is
 * `NOT NULL DEFAULT now()`, so it can't be used to distinguish a signed row
 * from an unsigned one; the acceptance row itself only ever gets created at
 * the moment of signing (see `POST /api/consent/[token]`), so "a matching
 * consent_acceptances row exists" IS "signed". A performed procedure
 * (`performed_at IS NOT NULL`, not soft-deleted) with no `consent_acceptances`
 * row pointing at it is a consent gap.
 *
 * A patient can have both gaps at once (`missing: 'both'`). When a patient
 * has more than one performed procedure lacking a signed consent, only the
 * most recently performed one is surfaced on the row: one row per patient,
 * one send action per row.
 *
 * Ordered by the surfaced procedure's date descending (freshest compliance
 * gap first); a patient whose only gap is a missing anamnese has no
 * procedure to date by, so those rows sort after every dated one, capped at
 * `MAX_ROWS`.
 */
export async function listDocumentGaps(
  tenantId: string,
  { sort }: ListDocumentGapsOptions,
): Promise<DocumentGapRow[]> {
  const [allPatients, anamneseRows, performedProcedures, acceptanceRows] = await Promise.all([
    db
      .select({ id: patients.id, fullName: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), isNull(patients.deletedAt))),
    db
      .select({ patientId: anamneses.patientId })
      .from(anamneses)
      .where(eq(anamneses.tenantId, tenantId)),
    db
      .select({
        id: procedureRecords.id,
        patientId: procedureRecords.patientId,
        performedAt: procedureRecords.performedAt,
        procedureTypeName: procedureTypes.name,
      })
      .from(procedureRecords)
      .innerJoin(procedureTypes, eq(procedureRecords.procedureTypeId, procedureTypes.id))
      .where(
        and(
          eq(procedureRecords.tenantId, tenantId),
          isNull(procedureRecords.deletedAt),
          isNotNull(procedureRecords.performedAt),
        ),
      ),
    db
      .select({ procedureRecordId: consentAcceptances.procedureRecordId })
      .from(consentAcceptances)
      .where(and(eq(consentAcceptances.tenantId, tenantId), isNotNull(consentAcceptances.procedureRecordId))),
  ])

  const hasAnamnese = new Set(anamneseRows.map((row) => row.patientId))
  const signedProcedureIds = new Set(
    acceptanceRows.map((row) => row.procedureRecordId).filter((id): id is string => id !== null),
  )

  // Most recent performed procedure, per patient, that still lacks a signed
  // consent acceptance. `performedProcedures` isn't ordered by the DB, so
  // track the best candidate seen so far per patient rather than relying on
  // query order.
  const consentGapByPatient = new Map<string, { procedureTypeName: string; performedAt: Date }>()

  for (const proc of performedProcedures) {
    if (!proc.performedAt) continue // isNotNull already filters this; guards the type
    if (signedProcedureIds.has(proc.id)) continue

    const existing = consentGapByPatient.get(proc.patientId)
    if (!existing || proc.performedAt > existing.performedAt) {
      consentGapByPatient.set(proc.patientId, {
        procedureTypeName: proc.procedureTypeName,
        performedAt: proc.performedAt,
      })
    }
  }

  const rows: DocumentGapRow[] = []

  for (const patient of allPatients) {
    const missingAnamnese = !hasAnamnese.has(patient.id)
    const gap = consentGapByPatient.get(patient.id)
    const missingConsent = gap !== undefined

    if (!missingAnamnese && !missingConsent) continue

    const missing: DocumentGapMissing =
      missingAnamnese && missingConsent ? 'both' : missingAnamnese ? 'anamnese' : 'consentimento'

    rows.push({
      patientId: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      missing,
      procedureTypeName: gap?.procedureTypeName ?? null,
      procedureDate: gap ? toBrYmd(gap.performedAt) : null,
    })
  }

  if (sort) {
    const accessor = SORT_ACCESSORS[sort.key]
    rows.sort((a, b) => directionalCompare(accessor(a), accessor(b), sort.dir))
  } else {
    // Default urgency order: most recent compliance gap first. A row with
    // no dated gap (anamnese-only) sorts after every dated one instead of
    // competing with them under a null-as-zero comparison.
    rows.sort((a, b) => {
      if (a.procedureDate === null && b.procedureDate === null) return 0
      if (a.procedureDate === null) return 1
      if (b.procedureDate === null) return -1
      return b.procedureDate.localeCompare(a.procedureDate)
    })
  }

  // The cap MUST apply after sorting, not before: with an explicit sort the
  // "top 200" has to be the top 200 of the requested order.
  return rows.slice(0, MAX_ROWS)
}
