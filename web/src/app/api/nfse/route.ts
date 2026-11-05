import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { maskCEP, maskCPF } from '@/lib/masks'
import { withTransaction } from '@/lib/tenant'
import { nfseEmitSchema } from '@/validations/nfse'
import { getDocument, getNfseSettings, listPaymentRecordsForEmission } from '@/db/queries/nfse'
import {
  appointments,
  financialEntries,
  installments,
  patients,
  paymentRecords,
  procedureRecords,
  tenants,
} from '@/db/schema'
import { handleApiError } from '@/lib/api-error'
import { createAuditLog } from '@/lib/audit'
import { brToday } from '@/lib/dates'
import { BusinessError } from '@/lib/errors'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { competenceIsPastMonth, defaultCompetenceDate } from '@/lib/nfse/competence'
import { NFSE_MAX_PER_REQUEST, nfseEnvironment } from '@/lib/nfse/config'
import { createDocuments, processDocuments, updateRetryIntent } from '@/lib/nfse/emission'
import { resolveNfseTaker } from '@/lib/nfse/taker-address'
import type { NfseProcessResult } from '@/lib/nfse/types'

export const maxDuration = 300

const EMIT_ROLES = ['owner', 'receptionist', 'financial'] as const
const TAKER_EDIT_ROLES = ['owner', 'receptionist']

function notConfigured() {
  return NextResponse.json(
    { error: 'Configure a NFS-e nas configurações.', code: 'NFSE_NOT_CONFIGURED' },
    { status: 409 },
  )
}

function businessResponse(error: BusinessError, status = 409) {
  return NextResponse.json({ error: error.message, code: error.code }, { status })
}

async function clinicAddressStandsIn(
  tenantId: string,
  takers: { patientId: string; cpf: string }[],
  clinicAddressFallback: boolean,
): Promise<boolean> {
  const [rows, [clinic]] = await Promise.all([
    db
      .select({ id: patients.id, address: patients.address })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), inArray(patients.id, takers.map((t) => t.patientId)))),
    db.select({ address: tenants.address }).from(tenants).where(eq(tenants.id, tenantId)),
  ])
  return takers.every((taker) => {
    const patient = rows.find((row) => row.id === taker.patientId)
    return (
      resolveNfseTaker({
        cpf: taker.cpf,
        patientAddress: patient?.address,
        clinicAddress: clinic?.address,
        clinicAddressFallback,
      }).source === 'clinic'
    )
  })
}

function currentTaker(patient: { cpf: string | null; address: unknown }) {
  const a = (patient.address ?? {}) as Record<string, string | null | undefined>
  const get = (key: string) => a[key] ?? ''
  return {
    cpf: patient.cpf ?? '',
    zip: get('zip'),
    street: get('street'),
    number: get('number'),
    complement: get('complement'),
    neighborhood: get('neighborhood'),
    city: get('city'),
    state: get('state'),
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole(...EMIT_ROLES)

    const raw = new URL(request.url).searchParams.get('paymentRecordIds') ?? ''
    const parsed = z.array(z.guid()).min(1).max(NFSE_MAX_PER_REQUEST).safeParse([...new Set(raw.split(',').filter(Boolean))])
    if (!parsed.success) {
      return NextResponse.json({ error: 'Pagamentos inválidos' }, { status: 400 })
    }
    const ids = parsed.data

    const records = await listPaymentRecordsForEmission(ctx.tenantId, ids)
    if (records.length !== ids.length) {
      return NextResponse.json({ error: 'Pagamento não encontrado.' }, { status: 404 })
    }

    const settings = await getNfseSettings(ctx.tenantId)
    if (!settings?.configured) return notConfigured()

    const patientIds = [...new Set(records.map((r) => r.patientId))]
    const [patientRows, serviceRows, [clinic]] = await Promise.all([
      db
        .select({ id: patients.id, fullName: patients.fullName, cpf: patients.cpf, email: patients.email, address: patients.address })
        .from(patients)
        .where(and(eq(patients.tenantId, ctx.tenantId), inArray(patients.id, patientIds))),
      db
        .select({
          id: paymentRecords.id,
          paidAt: paymentRecords.paidAt,
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
        .where(and(eq(installments.tenantId, ctx.tenantId), inArray(paymentRecords.id, ids))),
      db.select({ address: tenants.address }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
    ])

    const today = brToday()
    const defaultCompetence = serviceRows
      .map((r) =>
        defaultCompetenceDate({
          performedAt: r.performedAt,
          appointmentDate: r.appointmentDate,
          paidAt: r.paidAt,
          today,
        }),
      )
      .sort()[0]

    const canEditTaker = TAKER_EDIT_ROLES.includes(ctx.role)
    const grouped = patientRows.map((patient) => {
      const own = records.filter((r) => r.patientId === patient.id)
      const taker = resolveNfseTaker({
        cpf: patient.cpf,
        patientAddress: patient.address,
        clinicAddress: clinic?.address,
        clinicAddressFallback: settings.clinicAddressFallback,
      })
      return {
        patientId: patient.id,
        patientName: patient.fullName,
        paymentRecordIds: own.map((r) => r.id),
        total: own.reduce((sum, r) => sum + Number(r.amount), 0),
        missing: taker.ok ? [] : taker.missing,
        addressSource: taker.source,
        email: patient.email,
        canEditTaker,
        current: canEditTaker ? currentTaker(patient) : null,
      }
    })

    return NextResponse.json({
      data: {
        patients: grouped,
        defaultCompetence,
        competenceIsPastMonth: competenceIsPastMonth(defaultCompetence, today),
        settings: { emailPatient: settings.emailPatient },
      },
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite(...EMIT_ROLES)
    if (blocked) return blocked

    const parsed = nfseEmitSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const { competence, sendEmail, takers = [] } = parsed.data
    const ids = [...new Set(parsed.data.paymentRecordIds)]

    const records = await listPaymentRecordsForEmission(ctx.tenantId, ids)
    if (records.length !== ids.length) {
      return NextResponse.json({ error: 'Pagamento não encontrado.', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (records.some((r) => r.reversedAt)) {
      return NextResponse.json(
        { error: 'Não é possível emitir NFS-e de um pagamento estornado.', code: 'PAYMENT_REVERSED' },
        { status: 409 },
      )
    }
    if (records.some((r) => r.activeDocumentId)) {
      return NextResponse.json(
        { error: 'Já existe NFS-e para este pagamento.', code: 'NFSE_ALREADY_ACTIVE' },
        { status: 409 },
      )
    }
    const settings = await getNfseSettings(ctx.tenantId)
    if (!settings?.configured) return notConfigured()

    if (takers.length > 0) {
      if (!TAKER_EDIT_ROLES.includes(ctx.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const selected = new Set(records.map((r) => r.patientId))
      if (takers.some((t) => !selected.has(t.patientId))) {
        return NextResponse.json(
          { error: 'Paciente fora da seleção.', code: 'TAKER_NOT_SELECTED' },
          { status: 400 },
        )
      }
      const cpfOnly = takers.filter((t) => !t.address)
      if (cpfOnly.length > 0 && !(await clinicAddressStandsIn(ctx.tenantId, cpfOnly, settings.clinicAddressFallback))) {
        return NextResponse.json(
          { error: 'Complete o endereço do paciente.', code: 'TAKER_ADDRESS_REQUIRED' },
          { status: 400 },
        )
      }
    }

    const retryIds = records.flatMap((r) => (r.failedDocumentId ? [r.failedDocumentId] : []))
    const freshIds = records.filter((r) => !r.failedDocumentId).map((r) => r.id)

    let createdIds: string[] = []
    try {
      createdIds = await withTransaction(async (tx) => {
        for (const taker of takers) {
          const [previous] = await tx
            .select({ cpf: patients.cpf, address: patients.address })
            .from(patients)
            .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, taker.patientId)))
          const next = {
            cpf: maskCPF(taker.cpf),
            ...(taker.address && {
              address: { ...((previous?.address as object | null) ?? {}), ...taker.address, zip: maskCEP(taker.address.zip) },
            }),
          }
          await tx
            .update(patients)
            .set({ ...next, updatedAt: new Date() })
            .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, taker.patientId)))
          await createAuditLog(
            {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              action: 'update',
              entityType: 'patient',
              entityId: taker.patientId,
              changes: { patient: { old: previous, new: next } },
            },
            tx,
          )
        }
        if (freshIds.length === 0) return []
        const created = await createDocuments(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          paymentRecordIds: freshIds,
          competence,
          emailRequested: sendEmail,
          environment: nfseEnvironment(),
        })
        if (created.length !== freshIds.length) {
          throw new BusinessError('NFSE_ALREADY_ACTIVE', 'Já existe NFS-e para este pagamento.')
        }
        return created
      })
    } catch (error) {
      if (error instanceof BusinessError) return businessResponse(error)
      throw error
    }

    for (const id of retryIds) {
      await updateRetryIntent(ctx.tenantId, id, { competence, emailRequested: sendEmail })
    }

    const allIds = [...retryIds, ...createdIds]
    const processed = await processDocuments(allIds, 'manual', Date.now() + 200_000)
    const byId = new Map(processed.map((r) => [r.id, r]))
    const results: NfseProcessResult[] = await Promise.all(
      allIds.map(async (id) => {
        const done = byId.get(id)
        if (done) return done
        const doc = await getDocument(ctx.tenantId, id)
        return { id, status: doc?.status ?? 'pending' }
      }),
    )

    return NextResponse.json({ data: results })
  } catch (error) {
    return handleApiError(error, request)
  }
}
