import { findMunicipalityCode } from '@bullcode/fiscal'
import { dpsId } from '@bullcode/fiscal/nfse'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  claimDocument,
  failExhaustedClaims,
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
  MAX_CANCEL_ATTEMPTS,
  nextDpsNumber,
  NOTHING_AT_SEFIN_CODES,
  SEFIN_REJECTED_CODE,
  requestCancellation,
  REVERSAL_CANCEL_REASON,
  REVERSAL_JUSTIFICATION,
  saveDpsIdentity,
  saveRetryIntent,
  type ClaimedNfseDocument,
  type DbExecutor,
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
const REVERSED_MESSAGE = 'O pagamento foi estornado.'
const UNAVAILABLE_MESSAGE = 'Sefin Nacional indisponível. Tentaremos de novo.'
const EXHAUSTED_MESSAGE = 'A emissão não foi concluída depois de várias tentativas. Tente de novo.'
const NOTHING_AT_SEFIN = new Set(NOTHING_AT_SEFIN_CODES)

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocumentForProcessing>>>

async function selectDocument(id: string) {
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

async function fail(claimed: ClaimedNfseDocument, code: string, message: string): Promise<NfseProcessResult> {
  await markFailed(claimed, code, message)
  return finish(claimed.id)
}

function couldHaveReachedSefin(doc: { dpsId: string | null; errorCode: string | null }): boolean {
  return doc.dpsId !== null && doc.errorCode !== SEFIN_REJECTED_CODE
}

async function readReversalState(id: string) {
  const [row] = await db
    .select({ reversedAt: paymentRecords.reversedAt, cancelRequestedAt: nfseDocuments.cancelRequestedAt })
    .from(nfseDocuments)
    .innerJoin(paymentRecords, eq(paymentRecords.id, nfseDocuments.paymentRecordId))
    .where(eq(nfseDocuments.id, id))
  return row
}

function competenceFor(
  choice: NfseCompetenceChoice,
  service: { performedAt: Date | null; appointmentDate: string | null; paidAt: Date },
  today: string,
): string {
  return choice === 'today' ? today : defaultCompetenceDate({ ...service, today })
}

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
      competenceDate: competenceFor(args.competence, r, today),
      emailRequested: args.emailRequested,
      createdBy: args.userId,
    })),
  )
}

type SnapshotResult = { ok: true; snapshot: NfseSnapshot } | { ok: false; code: string; message: string }

async function buildSnapshot(
  claimed: ClaimedNfseDocument,
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
        ? `${entry.description} - Parcela ${installment.installmentNumber}/${installmentCount}`
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
    if (error instanceof BusinessError && error.code === PATIENT_EMAIL_MISSING) return
    reportSideEffectFailure(error, { area: 'nfse', step: 'email', extra: { documentId: id } })
  }
}

async function completeIssued(
  claimed: ClaimedNfseDocument,
  loaded: LoadedDocument,
  issued: { accessKey: string; nfseXml: string },
): Promise<NfseProcessResult> {
  const nfseNumber = readNfseNumber(issued.nfseXml)
  const owned = await markIssued(claimed, { accessKey: issued.accessKey, nfseNumber, nfseXml: issued.nfseXml })
  if (!owned) return finish(claimed.id)
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

async function run(claimed: ClaimedNfseDocument): Promise<NfseProcessResult> {
  const id = claimed.id
  const loaded = await loadDocumentForProcessing(id)
  if (!loaded) return fail(claimed, 'invalid_request', 'Pagamento não encontrado.')

  const isRetry = claimed.attemptCount > 1
  const mayHaveReachedSefin = isRetry && couldHaveReachedSefin(claimed)
  const reversed = loaded.paymentRecord.reversedAt !== null
  if (reversed && !mayHaveReachedSefin) return fail(claimed, 'payment_reversed', REVERSED_MESSAGE)

  const settings = await getNfseSettingsWithSecrets(claimed.tenantId)
  if (!settings?.configured) {
    return fail(claimed, 'not_configured', 'Configure a NFS-e e o certificado digital nas configurações.')
  }
  let gateway
  try {
    gateway = createNfseGateway(settings, claimed.environment)
  } catch (error) {
    if (error instanceof NfseGatewayError) return fail(claimed, error.code, error.message)
    throw error
  }

  let snapshot = claimed.payloadSnapshot
  if (mayHaveReachedSefin && snapshot) {
    let found
    try {
      found = await gateway.reconcile(snapshot)
    } catch {
      return fail(
        claimed,
        'reconcile_unavailable',
        'Não foi possível confirmar na Sefin se a nota já foi emitida. Tentaremos de novo.',
      )
    }
    if (found.kind === 'issued') return completeIssued(claimed, loaded, found)
    if (found.kind === 'ambiguous') {
      return fail(
        claimed,
        'reconcile_ambiguous',
        'Já existe uma NFS-e com este número de DPS que não corresponde a este pagamento. Verifique manualmente.',
      )
    }
  }

  if (reversed || (await readReversalState(id)).reversedAt) return fail(claimed, 'payment_reversed', REVERSED_MESSAGE)

  if (!snapshot || NOTHING_AT_SEFIN.has(claimed.errorCode ?? '')) {
    const built = await buildSnapshot(claimed, loaded, settings)
    if (!built.ok) return fail(claimed, built.code, built.message)
    snapshot = built.snapshot
  }

  let issued
  try {
    issued = await gateway.emit(snapshot)
  } catch (error) {
    if (error instanceof NfseGatewayError) return fail(claimed, error.code, error.message)
    reportSideEffectFailure(error, { area: 'nfse', step: 'emit', extra: { documentId: id } })
    return fail(claimed, 'provider_error', UNAVAILABLE_MESSAGE)
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
    await markFailed(claimed, 'provider_error', UNAVAILABLE_MESSAGE)
    return finish(id)
  }
}

export async function updateRetryIntent(
  tenantId: string,
  documentId: string,
  intent: { competence: NfseCompetenceChoice; emailRequested: boolean },
): Promise<void> {
  const loaded = await loadDocumentForProcessing(documentId)
  if (!loaded || loaded.document.tenantId !== tenantId) throw new BusinessError('NFSE_NOT_FOUND', 'Nota não encontrada.')
  const competenceDate = couldHaveReachedSefin(loaded.document)
    ? undefined
    : competenceFor(intent.competence, { ...loaded, paidAt: loaded.paymentRecord.paidAt }, brToday())
  await saveRetryIntent(tenantId, documentId, { emailRequested: intent.emailRequested, competenceDate })
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
  } catch (error) {
    if (!(error instanceof NfseGatewayError)) {
      reportSideEffectFailure(error, { area: 'nfse', step: 'cancel', extra: { documentId: id } })
    }
    const attempts = await markCancelAttemptFailed(id, error instanceof NfseGatewayError ? error.message : UNAVAILABLE_MESSAGE)
    if (attempts === MAX_CANCEL_ATTEMPTS) {
      reportSideEffectFailure(new Error('NFS-e cancellation attempts exhausted'), {
        area: 'nfse',
        step: 'cancel-exhausted',
        extra: { documentId: id },
      })
    }
    return 'failed'
  }
  if (!(await markCancelled(id))) return 'cancelled'

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
  if (doc.status !== 'issued') {
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
): Promise<{ cancellations: number; exhausted: number; backfilled: number; processed: number }> {
  const cancellations = await guarded('cancel', 0, async () => {
    let attempted = 0
    for (const id of await listCancellationsToRetry(BATCH_SIZE)) {
      if (Date.now() >= deadlineAt) break
      await cancelDocument(id)
      attempted++
    }
    return attempted
  })

  const exhausted = await guarded('exhausted', 0, () => failExhaustedClaims(EXHAUSTED_MESSAGE))

  const backfilled = await guarded('backfill', 0, () => backfillAlwaysDocuments(deadlineAt))

  const processed = await guarded('process', 0, async () => {
    if (Date.now() >= deadlineAt) return 0
    const results = await processDocuments(await listRetryableDocumentIds(BATCH_SIZE), 'auto', deadlineAt)
    return results.length
  })

  return { cancellations, exhausted, backfilled, processed }
}
