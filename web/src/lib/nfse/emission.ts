import { findMunicipalityCode } from '@bullcode/fiscal'
import { dpsId } from '@bullcode/fiscal/nfse'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  claimDocument,
  getDocument,
  getNfseSettings,
  getNfseSettingsWithSecrets,
  insertPendingDocuments,
  listAlwaysPaymentsMissingDocuments,
  listCancellationsToRetry,
  listRetryableDocumentIds,
  loadDocumentForProcessing,
  markCancelAttemptFailed,
  markCancelled,
  markFailed,
  markIssued,
  markPendingReversed,
  nextDpsNumber,
  requestCancellation,
  saveDpsIdentity,
  type DbExecutor,
  type NfseDocumentRow,
} from '@/db/queries/nfse'
import { appointments, financialEntries, installments, nfseDocuments, paymentRecords, procedureRecords } from '@/db/schema'
import { createAuditLog } from '@/lib/audit'
import { isValidCep, isValidCpf, onlyDigits } from '@/lib/br-documents'
import { brToday } from '@/lib/dates'
import { BusinessError } from '@/lib/errors'
import { reportSideEffectFailure } from '@/lib/observability'
import { defaultCompetenceDate } from './competence'
import { NFSE_DPS_SERIES, nfseEnvironment } from './config'
import { createNfseGateway, NfseGatewayError } from './gateway'
import { PATIENT_EMAIL_MISSING, sendNfseEmail } from './nfse-email'
import { resolveServiceCodes } from './presets'
import type {
  NfseCancelReason,
  NfseCompetenceChoice,
  NfseEnvironment,
  NfseProcessResult,
  NfseSettingsWithSecrets,
  NfseSnapshot,
} from './types'
import { readNfseNumber } from './xml'

const BATCH_SIZE = 20
const REVERSAL_CANCEL_REASON: NfseCancelReason = 2
const REVERSAL_JUSTIFICATION = 'Pagamento estornado no FloraClin.'
const REVERSED_MESSAGE = 'O pagamento foi estornado.'
const UNAVAILABLE_MESSAGE = 'Sefin Nacional indisponível. Tentaremos de novo.'
const NEEDS_A_PERSON = new Set([
  'invalid_request',
  'missing_taker_data',
  'not_configured',
  'certificate_expired',
  'unauthorized',
  'reconcile_unavailable',
])
const NOTHING_AT_SEFIN_CODES = new Set(['invalid_request', 'missing_taker_data'])

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocumentForProcessing>>>

async function selectDocument(id: string): Promise<NfseDocumentRow | null> {
  const [row] = await db.select().from(nfseDocuments).where(eq(nfseDocuments.id, id))
  return row ?? null
}

async function finish(id: string): Promise<NfseProcessResult> {
  const row = await selectDocument(id)
  if (!row) return { id, status: 'failed', errorCode: 'invalid_request', errorMessage: 'Nota não encontrada.' }
  return {
    id,
    status: row.status,
    ...(row.errorCode ? { errorCode: row.errorCode, errorMessage: row.errorMessage ?? undefined } : {}),
  }
}

async function fail(id: string, code: string, message: string): Promise<NfseProcessResult> {
  await markFailed(id, code, message)
  return finish(id)
}

async function readReversalState(id: string) {
  const [row] = await db
    .select({ reversedAt: paymentRecords.reversedAt, cancelRequestedAt: nfseDocuments.cancelRequestedAt })
    .from(nfseDocuments)
    .innerJoin(paymentRecords, eq(paymentRecords.id, nfseDocuments.paymentRecordId))
    .where(eq(nfseDocuments.id, id))
  return row
}

// ── creation ──

export async function createDocuments(
  tx: DbExecutor,
  args: {
    tenantId: string
    userId: string
    paymentRecordIds: string[]
    competence: NfseCompetenceChoice
    emailRequested: boolean
    environment: NfseEnvironment
  },
): Promise<string[]> {
  if (args.paymentRecordIds.length === 0) return []
  const records = await tx
    .select({
      id: paymentRecords.id,
      amount: paymentRecords.amount,
      paidAt: paymentRecords.paidAt,
      patientId: financialEntries.patientId,
      performedAt: procedureRecords.performedAt,
      appointmentDate: appointments.date,
    })
    .from(paymentRecords)
    .innerJoin(installments, eq(installments.id, paymentRecords.installmentId))
    .innerJoin(financialEntries, eq(financialEntries.id, installments.financialEntryId))
    .leftJoin(procedureRecords, eq(procedureRecords.id, financialEntries.procedureRecordId))
    .leftJoin(
      appointments,
      eq(appointments.id, sql`COALESCE(${financialEntries.appointmentId}, ${procedureRecords.appointmentId})`),
    )
    .where(
      and(
        eq(installments.tenantId, args.tenantId),
        inArray(paymentRecords.id, args.paymentRecordIds),
        isNull(paymentRecords.reversedAt),
      ),
    )

  const today = brToday()
  return insertPendingDocuments(
    tx,
    records.map((r) => ({
      tenantId: args.tenantId,
      paymentRecordId: r.id,
      patientId: r.patientId,
      environment: args.environment,
      value: r.amount,
      competenceDate:
        args.competence === 'today'
          ? today
          : defaultCompetenceDate({
              performedAt: r.performedAt,
              appointmentDate: r.appointmentDate,
              paidAt: r.paidAt,
              today,
            }),
      emailRequested: args.emailRequested,
      createdBy: args.userId,
    })),
  )
}

// ── processing ──

type SnapshotResult = { ok: true; snapshot: NfseSnapshot } | { ok: false; code: string; message: string }

async function buildSnapshot(
  claimed: NfseDocumentRow,
  loaded: LoadedDocument,
  settings: NfseSettingsWithSecrets,
): Promise<SnapshotResult> {
  const { patient, entry, installment, installmentCount } = loaded
  const address = (patient.address ?? {}) as Record<string, string | undefined>
  const cityCode = address.city && address.state ? findMunicipalityCode(address.city, address.state) : null

  const missing: string[] = []
  if (!isValidCpf(patient.cpf ?? '')) missing.push('CPF')
  if (!isValidCep(address.zip ?? '')) missing.push('CEP')
  if (!address.street?.trim()) missing.push('logradouro')
  if (!address.number?.trim()) missing.push('número')
  if (!address.neighborhood?.trim()) missing.push('bairro')
  if (!cityCode) missing.push('cidade')
  if (missing.length > 0) {
    return { ok: false, code: 'missing_taker_data', message: `Complete o cadastro do paciente: ${missing.join(', ')}.` }
  }

  let service
  try {
    service = resolveServiceCodes(settings)
  } catch {
    return { ok: false, code: 'not_configured', message: 'Configure o serviço da NFS-e nas configurações.' }
  }

  const providerCnpj = settings.certificate.cnpj
  const previous = claimed.payloadSnapshot
  const keepNumber =
    previous &&
    claimed.dpsNumber !== null &&
    previous.providerCnpj === providerCnpj &&
    previous.municipalityCode === settings.municipalityCode &&
    previous.series === NFSE_DPS_SERIES
  const dpsNumber = keepNumber
    ? String(claimed.dpsNumber)
    : await nextDpsNumber(db, { cnpj: providerCnpj, municipalityCode: settings.municipalityCode, series: NFSE_DPS_SERIES })

  const snapshot: NfseSnapshot = {
    environment: claimed.environment,
    providerCnpj,
    municipalRegistration: settings.municipalRegistration,
    municipalityCode: settings.municipalityCode,
    simplesNacionalOption: settings.simplesNacionalOption,
    simplesNacionalRegime: settings.simplesNacionalRegime,
    simplesNacionalTaxRate: settings.simplesNacionalTaxRate,
    issRate: settings.issRate,
    issWithheld: settings.issWithheld,
    service,
    taker: {
      cpf: onlyDigits(patient.cpf ?? ''),
      name: patient.fullName,
      email: patient.email || null,
      address: {
        zip: onlyDigits(address.zip ?? ''),
        street: address.street!.trim(),
        number: address.number!.trim(),
        complement: address.complement?.trim() || null,
        neighborhood: address.neighborhood!.trim(),
        city: address.city!,
        state: address.state!,
      },
      cityCode: cityCode!,
    },
    description:
      installmentCount > 1
        ? `${entry.description} - parcela ${installment.installmentNumber}/${installmentCount}`
        : entry.description,
    value: Number(claimed.value),
    competenceDate: claimed.competenceDate,
    series: NFSE_DPS_SERIES,
    dpsNumber,
  }

  await saveDpsIdentity(claimed.id, {
    snapshot,
    dpsNumber,
    dpsId: dpsId({
      cLocEmi: snapshot.municipalityCode,
      CNPJ: providerCnpj,
      serie: NFSE_DPS_SERIES,
      nDPS: dpsNumber,
    }),
  })
  return { ok: true, snapshot }
}

async function sendEmailSafely(id: string): Promise<void> {
  try {
    await sendNfseEmail(id)
  } catch (error) {
    if (error instanceof Error && error.message === PATIENT_EMAIL_MISSING) return
    reportSideEffectFailure(error, { area: 'nfse', step: 'email', extra: { documentId: id } })
  }
}

async function completeIssued(
  claimed: NfseDocumentRow,
  loaded: LoadedDocument,
  issued: { accessKey: string; nfseXml: string },
): Promise<NfseProcessResult> {
  const nfseNumber = readNfseNumber(issued.nfseXml)
  await markIssued(claimed.id, { accessKey: issued.accessKey, nfseNumber, nfseXml: issued.nfseXml })
  try {
    await createAuditLog({
      tenantId: claimed.tenantId,
      userId: claimed.createdBy ?? loaded.paymentRecord.recordedBy,
      action: 'create',
      entityType: 'nfse_document',
      entityId: claimed.id,
      changes: { status: { old: 'processing', new: 'issued' }, nfseNumber: { old: null, new: nfseNumber } },
    })
  } catch (error) {
    reportSideEffectFailure(error, { area: 'nfse', step: 'audit', extra: { documentId: claimed.id } })
  }

  const state = await readReversalState(claimed.id)
  if (state.reversedAt || state.cancelRequestedAt) {
    if (!state.cancelRequestedAt) {
      await requestCancellation(db, [claimed.id], REVERSAL_CANCEL_REASON, REVERSAL_JUSTIFICATION)
    }
    await cancelDocument(claimed.id)
  } else if (claimed.emailRequested) {
    await sendEmailSafely(claimed.id)
  }
  return finish(claimed.id)
}

async function run(claimed: NfseDocumentRow): Promise<NfseProcessResult> {
  const id = claimed.id
  const loaded = await loadDocumentForProcessing(id)
  if (!loaded) return fail(id, 'invalid_request', 'Pagamento não encontrado.')

  const lastCode = claimed.errorCode ?? ''
  const reconcileFirst = claimed.attemptCount > 1 && !NOTHING_AT_SEFIN_CODES.has(lastCode)
  const reversed = loaded.paymentRecord.reversedAt !== null
  if (reversed && !(reconcileFirst && claimed.dpsId)) return fail(id, 'payment_reversed', REVERSED_MESSAGE)

  const settings = await getNfseSettingsWithSecrets(claimed.tenantId)
  if (!settings?.configured) {
    return fail(id, 'not_configured', 'Configure a NFS-e e o certificado digital nas configurações.')
  }
  let gateway
  try {
    gateway = createNfseGateway(settings, claimed.environment)
  } catch (error) {
    if (error instanceof NfseGatewayError) return fail(id, error.code, error.message)
    throw error
  }

  let snapshot = claimed.payloadSnapshot
  if (!snapshot || NEEDS_A_PERSON.has(lastCode)) {
    const built = await buildSnapshot(claimed, loaded, settings)
    if (!built.ok) return fail(id, built.code, built.message)
    snapshot = built.snapshot
  }

  if (reconcileFirst) {
    let found
    try {
      found = await gateway.reconcile(snapshot)
    } catch {
      return fail(id, 'reconcile_unavailable', 'Não foi possível confirmar na Sefin se a nota já foi emitida. Tente de novo.')
    }
    if (found.kind === 'issued') return completeIssued(claimed, loaded, found)
    if (found.kind === 'ambiguous') {
      return fail(
        id,
        'reconcile_ambiguous',
        'Já existe uma NFS-e com este número de DPS que não corresponde a este pagamento. Verifique manualmente.',
      )
    }
  }

  if (reversed || (await readReversalState(id)).reversedAt) return fail(id, 'payment_reversed', REVERSED_MESSAGE)

  let issued
  try {
    issued = await gateway.emit(snapshot)
  } catch (error) {
    if (error instanceof NfseGatewayError) return fail(id, error.code, error.message)
    reportSideEffectFailure(error, { area: 'nfse', step: 'emit', extra: { documentId: id } })
    return fail(id, 'provider_error', UNAVAILABLE_MESSAGE)
  }
  return completeIssued(claimed, loaded, issued)
}

export async function processDocument(id: string, mode: 'auto' | 'manual' = 'auto'): Promise<NfseProcessResult> {
  const claimed = await claimDocument(id, mode)
  if (!claimed) return finish(id)
  try {
    return await run(claimed)
  } catch (error) {
    reportSideEffectFailure(error, { area: 'nfse', step: 'process', extra: { documentId: id } })
    const current = await selectDocument(id)
    if (current?.status === 'processing') await markFailed(id, 'provider_error', UNAVAILABLE_MESSAGE)
    return finish(id)
  }
}

export async function processDocuments(
  ids: string[],
  mode: 'auto' | 'manual' = 'auto',
  deadlineAt?: number,
): Promise<NfseProcessResult[]> {
  const results: NfseProcessResult[] = []
  for (const id of ids) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) break
    try {
      results.push(await processDocument(id, mode))
    } catch (error) {
      reportSideEffectFailure(error, { area: 'nfse', step: 'process-batch', extra: { documentId: id } })
    }
  }
  return results
}

// ── cancellation and reversal ──

async function cancelDocument(id: string, userId?: string): Promise<'cancelled' | 'failed'> {
  const doc = await selectDocument(id)
  if (!doc) return 'failed'
  if (doc.status === 'cancelled') return 'cancelled'
  if (doc.status !== 'issued' || !doc.cancelRequestedAt || !doc.accessKey || doc.cancelReason === null) return 'failed'

  try {
    const settings = await getNfseSettingsWithSecrets(doc.tenantId)
    if (!settings) throw new NfseGatewayError('not_configured', 'O certificado digital não está configurado.')
    await createNfseGateway(settings, doc.environment).cancel(
      doc.accessKey,
      doc.cancelReason,
      doc.cancelJustification ?? REVERSAL_JUSTIFICATION,
    )
    await markCancelled(id)
  } catch (error) {
    if (!(error instanceof NfseGatewayError)) {
      reportSideEffectFailure(error, { area: 'nfse', step: 'cancel', extra: { documentId: id } })
    }
    await markCancelAttemptFailed(id, error instanceof NfseGatewayError ? error.message : UNAVAILABLE_MESSAGE)
    return 'failed'
  }

  const auditUserId = userId ?? doc.createdBy
  if (auditUserId) {
    try {
      await createAuditLog({
        tenantId: doc.tenantId,
        userId: auditUserId,
        action: 'update',
        entityType: 'nfse_document',
        entityId: id,
        changes: { status: { old: 'issued', new: 'cancelled' } },
      })
    } catch (error) {
      reportSideEffectFailure(error, { area: 'nfse', step: 'audit', extra: { documentId: id } })
    }
  }
  return 'cancelled'
}

export function processCancellation(id: string): Promise<'cancelled' | 'failed'> {
  return cancelDocument(id)
}

export async function requestCancel(args: {
  tenantId: string
  userId: string
  documentId: string
  reason: NfseCancelReason
  justification: string
}): Promise<void> {
  const doc = await getDocument(args.tenantId, args.documentId)
  if (!doc) throw new BusinessError('NFSE_NOT_FOUND', 'Nota não encontrada.')
  if (doc.status !== 'issued' && doc.status !== 'processing') {
    throw new BusinessError('NFSE_NOT_CANCELLABLE', 'Só é possível cancelar uma nota emitida.')
  }
  await requestCancellation(db, [doc.id], args.reason, args.justification)
  await cancelDocument(doc.id, args.userId)
}

export async function markReversalInTx(
  tx: DbExecutor,
  paymentRecordIds: string[],
  cancelIssued: boolean,
): Promise<string[]> {
  if (paymentRecordIds.length === 0) return []
  await markPendingReversed(tx, paymentRecordIds)
  const live = await tx
    .select({ id: nfseDocuments.id, status: nfseDocuments.status })
    .from(nfseDocuments)
    .where(
      and(inArray(nfseDocuments.paymentRecordId, paymentRecordIds), inArray(nfseDocuments.status, ['processing', 'issued'])),
    )
  const toCancel = live.filter((d) => d.status === 'processing' || cancelIssued).map((d) => d.id)
  await requestCancellation(tx, toCancel, REVERSAL_CANCEL_REASON, REVERSAL_JUSTIFICATION)
  return toCancel
}

// ── cron ──

async function backfillAlwaysDocuments(deadlineAt: number): Promise<number> {
  const missing = await listAlwaysPaymentsMissingDocuments(BATCH_SIZE)
  if (missing.length === 0) return 0
  const recorders = await db
    .select({ id: paymentRecords.id, recordedBy: paymentRecords.recordedBy })
    .from(paymentRecords)
    .where(inArray(paymentRecords.id, missing.map((m) => m.paymentRecordId)))
  const recordedBy = new Map(recorders.map((r) => [r.id, r.recordedBy]))
  const settingsByTenant = new Map<string, Awaited<ReturnType<typeof getNfseSettings>>>()

  let created = 0
  for (const { tenantId, paymentRecordId } of missing) {
    if (Date.now() >= deadlineAt) break
    if (!settingsByTenant.has(tenantId)) settingsByTenant.set(tenantId, await getNfseSettings(tenantId))
    const settings = settingsByTenant.get(tenantId)
    const userId = recordedBy.get(paymentRecordId)
    if (!settings?.configured || settings.emissionMode !== 'always' || !userId) continue
    const ids = await db.transaction((tx) =>
      createDocuments(tx as unknown as DbExecutor, {
        tenantId,
        userId,
        paymentRecordIds: [paymentRecordId],
        competence: 'service',
        emailRequested: settings.emailPatient,
        environment: nfseEnvironment(),
      }),
    )
    created += ids.length
  }
  return created
}

async function guarded<T>(step: string, fallback: T, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    reportSideEffectFailure(error, { area: 'nfse', step: `cron-${step}` })
    return fallback
  }
}

export async function runNfseCron(
  deadlineAt: number,
): Promise<{ backfilled: number; processed: number; cancellations: number }> {
  const backfilled = await guarded('backfill', 0, () => backfillAlwaysDocuments(deadlineAt))

  const processed = await guarded('process', 0, async () => {
    if (Date.now() >= deadlineAt) return 0
    const results = await processDocuments(await listRetryableDocumentIds(BATCH_SIZE), 'auto', deadlineAt)
    return results.length
  })

  const cancellations = await guarded('cancel', 0, async () => {
    let attempted = 0
    for (const id of await listCancellationsToRetry(BATCH_SIZE)) {
      if (Date.now() >= deadlineAt) break
      await cancelDocument(id)
      attempted++
    }
    return attempted
  })

  return { backfilled, processed, cancellations }
}
