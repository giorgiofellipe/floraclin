import { findMunicipality } from '@bullcode/fiscal'
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lt, ne, not, notExists, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  appointments,
  financialEntries,
  installments,
  nfseDocuments,
  nfseSettings,
  patients,
  paymentRecords,
  procedureRecords,
  tenants,
} from '@/db/schema'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import type {
  NfseCancelReason,
  NfseCertificateInfo,
  NfseDocumentSummary,
  NfseEnvironment,
  NfseFiscalSettingsInput,
  NfseSettingsPublic,
  NfseSettingsWithSecrets,
  NfseSnapshot,
} from '@/lib/nfse/types'
import { rowsFromExecuteResult } from './admin-tenants'

export type DbExecutor = typeof db
export type NfseDocumentRow = typeof nfseDocuments.$inferSelect
export type NfseClaim = { id: string; claimedAt: Date }

const MAX_AUTO_ATTEMPTS = 5
export const MAX_CANCEL_ATTEMPTS = 10
const STALE_CLAIM_MS = 15 * 60 * 1000
const ALWAYS_BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const FINAL_ERROR_CODES = ['reconcile_ambiguous', 'payment_reversed']
const TRANSIENT_ERROR_CODES = ['provider_error', 'reconcile_unavailable']
export const NOTHING_AT_SEFIN_CODES = [
  'invalid_request',
  'missing_taker_data',
  'not_configured',
  'certificate_expired',
  'unauthorized',
]
export const SEFIN_REJECTED_CODE = 'invalid_request'
export const REVERSAL_CANCEL_REASON: NfseCancelReason = 2
export const REVERSAL_JUSTIFICATION = 'Pagamento estornado no FloraClin.'

const { certificatePfx: _pfx, certificatePassword: _password, ...publicSettingsColumns } = getTableColumns(nfseSettings)

type SettingsRow = typeof nfseSettings.$inferSelect
type PublicSettingsRow = Omit<SettingsRow, 'certificatePfx' | 'certificatePassword'>

function toPublic(row: PublicSettingsRow): NfseSettingsPublic {
  return {
    certificate: {
      cnpj: row.cnpj,
      subject: row.certificateSubject,
      issuer: row.certificateIssuer,
      validFrom: row.certificateValidFrom.toISOString(),
      validTo: row.certificateValidTo.toISOString(),
    },
    municipalityCode: row.municipalityCode ?? '',
    municipalityName: row.municipalityCode ? (findMunicipality(row.municipalityCode)?.name ?? null) : null,
    municipalRegistration: row.municipalRegistration,
    simplesNacionalOption: row.simplesNacionalOption ?? 1,
    simplesNacionalRegime: row.simplesNacionalRegime,
    simplesNacionalTaxRate: row.simplesNacionalTaxRate === null ? null : Number(row.simplesNacionalTaxRate),
    servicePreset: row.servicePreset,
    advancedCodes: row.advancedCodes,
    issRate: row.issRate === null ? null : Number(row.issRate),
    issWithheld: row.issWithheld,
    emissionMode: row.emissionMode,
    emailPatient: row.emailPatient,
    clinicAddressFallback: row.clinicAddressFallback,
    configured: row.configuredAt !== null,
  }
}

export async function getNfseSettings(tenantId: string): Promise<NfseSettingsPublic | null> {
  const [row] = await db
    .select(publicSettingsColumns)
    .from(nfseSettings)
    .where(eq(nfseSettings.tenantId, tenantId))
    .limit(1)
  return row ? toPublic(row) : null
}

export async function getNfseSettingsWithSecrets(tenantId: string): Promise<NfseSettingsWithSecrets | null> {
  const [row] = await db.select().from(nfseSettings).where(eq(nfseSettings.tenantId, tenantId)).limit(1)
  if (!row) return null
  return {
    ...toPublic(row),
    pfxBase64: decryptSecret(row.certificatePfx),
    password: decryptSecret(row.certificatePassword),
  }
}

export async function saveCertificate(
  tenantId: string,
  userId: string,
  cert: NfseCertificateInfo & { pfxBase64: string; password: string },
): Promise<void> {
  const certificate = {
    certificatePfx: encryptSecret(cert.pfxBase64),
    certificatePassword: encryptSecret(cert.password),
    cnpj: cert.cnpj,
    certificateSubject: cert.subject,
    certificateIssuer: cert.issuer,
    certificateValidFrom: new Date(cert.validFrom),
    certificateValidTo: new Date(cert.validTo),
    updatedBy: userId,
    updatedAt: new Date(),
  }
  await db
    .insert(nfseSettings)
    .values({ tenantId, ...certificate })
    .onConflictDoUpdate({ target: nfseSettings.tenantId, set: certificate })
}

export async function deleteNfseSettings(tenantId: string): Promise<void> {
  await db.delete(nfseSettings).where(eq(nfseSettings.tenantId, tenantId))
}

export async function saveFiscalSettings(
  tenantId: string,
  userId: string,
  input: NfseFiscalSettingsInput,
): Promise<void> {
  await db
    .update(nfseSettings)
    .set({
      municipalityCode: input.municipalityCode,
      municipalRegistration: input.municipalRegistration,
      simplesNacionalOption: input.simplesNacionalOption,
      simplesNacionalRegime: input.simplesNacionalRegime,
      simplesNacionalTaxRate: input.simplesNacionalTaxRate === null ? null : String(input.simplesNacionalTaxRate),
      servicePreset: input.servicePreset,
      advancedCodes: input.advancedCodes,
      issRate: input.issRate === null ? null : String(input.issRate),
      issWithheld: input.issWithheld,
      emissionMode: input.emissionMode,
      alwaysEnabledAt:
        input.emissionMode === 'always'
          ? sql`CASE WHEN ${nfseSettings.emissionMode} = 'always' THEN ${nfseSettings.alwaysEnabledAt} ELSE now() END`
          : null,
      emailPatient: input.emailPatient,
      clinicAddressFallback: input.clinicAddressFallback,
      configuredAt: new Date(),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(nfseSettings.tenantId, tenantId))
}

export async function nextDpsNumber(
  tx: DbExecutor,
  key: { cnpj: string; municipalityCode: string; series: string },
): Promise<string> {
  const result = await tx.execute(sql`
    INSERT INTO floraclin.nfse_dps_sequences (cnpj, municipality_code, series, last_number)
    VALUES (${key.cnpj}, ${key.municipalityCode}, ${key.series}, 1)
    ON CONFLICT (cnpj, municipality_code, series)
    DO UPDATE SET last_number = floraclin.nfse_dps_sequences.last_number + 1
    RETURNING last_number
  `)
  return String(rowsFromExecuteResult<{ last_number: string | number }>(result)[0].last_number)
}

export async function insertPendingDocuments(
  tx: DbExecutor,
  rows: {
    tenantId: string
    paymentRecordId: string
    patientId: string
    environment: NfseEnvironment
    value: string
    competenceDate: string
    emailRequested: boolean
    createdBy: string | null
  }[],
): Promise<string[]> {
  if (rows.length === 0) return []
  const inserted = await tx
    .insert(nfseDocuments)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: nfseDocuments.id })
  return inserted.map((r) => r.id)
}

function claimable(mode: 'auto' | 'manual') {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS)
  const stale = and(eq(nfseDocuments.status, 'processing'), lt(nfseDocuments.claimedAt, staleBefore))
  if (mode === 'auto') {
    return or(
      eq(nfseDocuments.status, 'pending'),
      and(
        eq(nfseDocuments.status, 'failed'),
        inArray(nfseDocuments.errorCode, TRANSIENT_ERROR_CODES),
        lt(nfseDocuments.attemptCount, MAX_AUTO_ATTEMPTS),
      ),
      and(stale, lt(nfseDocuments.attemptCount, MAX_AUTO_ATTEMPTS)),
    )
  }
  return or(
    eq(nfseDocuments.status, 'pending'),
    and(
      eq(nfseDocuments.status, 'failed'),
      or(isNull(nfseDocuments.errorCode), notInArray(nfseDocuments.errorCode, FINAL_ERROR_CODES)),
    ),
    stale,
  )
}

export type ClaimedNfseDocument = NfseDocumentRow & NfseClaim

export async function claimDocument(id: string, mode: 'auto' | 'manual'): Promise<ClaimedNfseDocument | null> {
  const [row] = await db
    .update(nfseDocuments)
    .set({
      status: 'processing',
      attemptCount: sql`${nfseDocuments.attemptCount} + 1`,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(nfseDocuments.id, id), claimable(mode)))
    .returning()
  return (row as ClaimedNfseDocument | undefined) ?? null
}

export async function listRetryableDocumentIds(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: nfseDocuments.id })
    .from(nfseDocuments)
    .where(claimable('auto'))
    .orderBy(nfseDocuments.createdAt)
    .limit(limit)
  return rows.map((r) => r.id)
}

export async function saveDpsIdentity(
  id: string,
  data: { snapshot: NfseSnapshot; dpsNumber: string; dpsId: string },
): Promise<void> {
  await db
    .update(nfseDocuments)
    .set({
      payloadSnapshot: data.snapshot,
      dpsNumber: Number(data.dpsNumber),
      dpsId: data.dpsId,
      updatedAt: new Date(),
    })
    .where(eq(nfseDocuments.id, id))
}

function ownsClaim(claim: NfseClaim) {
  return and(
    eq(nfseDocuments.id, claim.id),
    eq(nfseDocuments.status, 'processing'),
    eq(nfseDocuments.claimedAt, claim.claimedAt),
  )
}

export async function markIssued(
  claim: NfseClaim,
  data: { accessKey: string; nfseNumber: string | null; nfseXml: string },
): Promise<boolean> {
  const updated = await db
    .update(nfseDocuments)
    .set({
      status: 'issued',
      accessKey: data.accessKey,
      nfseNumber: data.nfseNumber,
      nfseXml: data.nfseXml,
      errorCode: null,
      errorMessage: null,
      claimedAt: null,
      issuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(ownsClaim(claim))
    .returning({ id: nfseDocuments.id })
  return updated.length > 0
}

export async function markFailed(claim: NfseClaim, code: string, message: string): Promise<void> {
  await db
    .update(nfseDocuments)
    .set({ status: 'failed', errorCode: code, errorMessage: message, claimedAt: null, updatedAt: new Date() })
    .where(ownsClaim(claim))
}

export async function failExhaustedClaims(message: string): Promise<number> {
  const updated = await db
    .update(nfseDocuments)
    .set({ status: 'failed', errorCode: 'provider_error', errorMessage: message, claimedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(nfseDocuments.status, 'processing'),
        gte(nfseDocuments.attemptCount, MAX_AUTO_ATTEMPTS),
        lt(nfseDocuments.claimedAt, new Date(Date.now() - STALE_CLAIM_MS)),
      ),
    )
    .returning({ id: nfseDocuments.id })
  return updated.length
}

export async function saveRetryIntent(
  tenantId: string,
  id: string,
  data: { emailRequested: boolean; competenceDate?: string },
): Promise<void> {
  await db
    .update(nfseDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(nfseDocuments.tenantId, tenantId), eq(nfseDocuments.id, id)))
}

export async function markEmailSent(id: string): Promise<void> {
  await db
    .update(nfseDocuments)
    .set({ emailSentAt: new Date(), updatedAt: new Date() })
    .where(eq(nfseDocuments.id, id))
}

export async function requestCancellation(
  tx: DbExecutor,
  ids: string[],
  reason: NfseCancelReason,
  justification: string,
): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(nfseDocuments)
    .set({
      cancelRequestedAt: new Date(),
      cancelReason: reason,
      cancelJustification: justification,
      updatedAt: new Date(),
    })
    .where(and(inArray(nfseDocuments.id, ids), ne(nfseDocuments.status, 'cancelled')))
}

export async function markCancelled(id: string): Promise<boolean> {
  const updated = await db
    .update(nfseDocuments)
    .set({ status: 'cancelled', cancelledAt: new Date(), errorMessage: null, updatedAt: new Date() })
    .where(and(eq(nfseDocuments.id, id), eq(nfseDocuments.status, 'issued')))
    .returning({ id: nfseDocuments.id })
  return updated.length > 0
}

export async function markCancelAttemptFailed(id: string, message: string): Promise<number> {
  const [row] = await db
    .update(nfseDocuments)
    .set({
      cancelAttemptCount: sql`${nfseDocuments.cancelAttemptCount} + 1`,
      errorMessage: message,
      updatedAt: new Date(),
    })
    .where(eq(nfseDocuments.id, id))
    .returning({ cancelAttemptCount: nfseDocuments.cancelAttemptCount })
  return row?.cancelAttemptCount ?? 0
}

export async function markPendingReversed(tx: DbExecutor, paymentRecordIds: string[]): Promise<void> {
  if (paymentRecordIds.length === 0) return
  const unsettled = and(
    inArray(nfseDocuments.paymentRecordId, paymentRecordIds),
    inArray(nfseDocuments.status, ['pending', 'failed']),
  )
  const mayHaveReachedSefin = and(
    isNotNull(nfseDocuments.dpsId),
    or(isNull(nfseDocuments.errorCode), notInArray(nfseDocuments.errorCode, [SEFIN_REJECTED_CODE, ...FINAL_ERROR_CODES])),
  )
  await tx
    .update(nfseDocuments)
    .set({
      cancelRequestedAt: new Date(),
      cancelReason: REVERSAL_CANCEL_REASON,
      cancelJustification: REVERSAL_JUSTIFICATION,
      updatedAt: new Date(),
    })
    .where(and(unsettled, mayHaveReachedSefin))
  await tx
    .update(nfseDocuments)
    .set({
      status: 'failed',
      errorCode: 'payment_reversed',
      errorMessage: 'O pagamento foi estornado.',
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(and(unsettled, not(mayHaveReachedSefin!)))
}

export async function listCancellationsToRetry(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: nfseDocuments.id })
    .from(nfseDocuments)
    .where(
      and(
        isNotNull(nfseDocuments.cancelRequestedAt),
        isNull(nfseDocuments.cancelledAt),
        eq(nfseDocuments.status, 'issued'),
        lt(nfseDocuments.cancelAttemptCount, MAX_CANCEL_ATTEMPTS),
      ),
    )
    .orderBy(nfseDocuments.cancelRequestedAt)
    .limit(limit)
  return rows.map((r) => r.id)
}

export async function loadDocumentForProcessing(id: string) {
  const [row] = await db
    .select({
      document: nfseDocuments,
      paymentRecord: paymentRecords,
      installment: installments,
      entry: financialEntries,
      patient: patients,
      clinicAddress: tenants.address,
      performedAt: procedureRecords.performedAt,
      appointmentDate: appointments.date,
    })
    .from(nfseDocuments)
    .innerJoin(paymentRecords, eq(paymentRecords.id, nfseDocuments.paymentRecordId))
    .innerJoin(
      installments,
      and(eq(installments.id, paymentRecords.installmentId), eq(installments.tenantId, nfseDocuments.tenantId)),
    )
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .innerJoin(patients, eq(patients.id, nfseDocuments.patientId))
    .innerJoin(tenants, eq(tenants.id, nfseDocuments.tenantId))
    .leftJoin(procedureRecords, eq(procedureRecords.id, financialEntries.procedureRecordId))
    .leftJoin(
      appointments,
      eq(appointments.id, sql`COALESCE(${financialEntries.appointmentId}, ${procedureRecords.appointmentId})`),
    )
    .where(eq(nfseDocuments.id, id))
    .limit(1)
  if (!row) return null
  return { ...row, installmentCount: row.entry.installmentCount }
}

export async function getDocument(tenantId: string, id: string): Promise<NfseDocumentRow | null> {
  const [row] = await db
    .select()
    .from(nfseDocuments)
    .where(and(eq(nfseDocuments.tenantId, tenantId), eq(nfseDocuments.id, id)))
    .limit(1)
  return row ?? null
}

export async function listDocumentsForPaymentRecords(
  tenantId: string,
  paymentRecordIds: string[],
): Promise<NfseDocumentSummary[]> {
  if (paymentRecordIds.length === 0) return []
  const rows = await db
    .select()
    .from(nfseDocuments)
    .where(and(eq(nfseDocuments.tenantId, tenantId), inArray(nfseDocuments.paymentRecordId, paymentRecordIds)))
    .orderBy(desc(nfseDocuments.createdAt))

  const chosen = new Map<string, NfseDocumentRow>()
  for (const row of rows) {
    const current = chosen.get(row.paymentRecordId)
    if (!current || (current.status === 'cancelled' && row.status !== 'cancelled')) {
      chosen.set(row.paymentRecordId, row)
    }
  }

  return [...chosen.values()].map((row) => ({
    id: row.id,
    paymentRecordId: row.paymentRecordId,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    nfseNumber: row.nfseNumber,
    competenceDate: row.competenceDate,
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    cancelRequested: row.cancelRequestedAt !== null && row.status !== 'cancelled',
    retryable: row.status === 'failed' && !FINAL_ERROR_CODES.includes(row.errorCode ?? ''),
  }))
}

/**
 * `activeDocumentId` is a non-cancelled, non-failed note (it blocks a new emission);
 * `failedDocumentId` is a failed note that a manual retry can take over.
 */
export async function listPaymentRecordsForEmission(
  tenantId: string,
  paymentRecordIds: string[],
): Promise<
  {
    id: string
    amount: string
    paidAt: Date
    reversedAt: Date | null
    patientId: string
    entryId: string
    activeDocumentId: string | null
    failedDocumentId: string | null
  }[]
> {
  if (paymentRecordIds.length === 0) return []
  const rows = await db
    .select({
      id: paymentRecords.id,
      amount: paymentRecords.amount,
      paidAt: paymentRecords.paidAt,
      reversedAt: paymentRecords.reversedAt,
      patientId: financialEntries.patientId,
      entryId: financialEntries.id,
      documentId: nfseDocuments.id,
      documentStatus: nfseDocuments.status,
    })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .leftJoin(
      nfseDocuments,
      and(eq(nfseDocuments.paymentRecordId, paymentRecords.id), ne(nfseDocuments.status, 'cancelled')),
    )
    .where(and(eq(installments.tenantId, tenantId), inArray(paymentRecords.id, paymentRecordIds)))

  return rows.map(({ documentId, documentStatus, ...row }) => ({
    ...row,
    activeDocumentId: documentId && documentStatus !== 'failed' ? documentId : null,
    failedDocumentId: documentId && documentStatus === 'failed' ? documentId : null,
  }))
}

export async function listAlwaysPaymentsMissingDocuments(
  limit: number,
): Promise<{ tenantId: string; paymentRecordId: string }[]> {
  return db
    .select({ tenantId: installments.tenantId, paymentRecordId: paymentRecords.id })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(nfseSettings, eq(nfseSettings.tenantId, installments.tenantId))
    .where(
      and(
        eq(nfseSettings.emissionMode, 'always'),
        isNotNull(nfseSettings.configuredAt),
        gte(paymentRecords.recordedAt, nfseSettings.alwaysEnabledAt),
        gte(paymentRecords.recordedAt, new Date(Date.now() - ALWAYS_BACKFILL_WINDOW_MS)),
        isNull(paymentRecords.reversedAt),
        notExists(
          db.select({ one: sql`1` }).from(nfseDocuments).where(eq(nfseDocuments.paymentRecordId, paymentRecords.id)),
        ),
      ),
    )
    .orderBy(paymentRecords.recordedAt)
    .limit(limit)
}
