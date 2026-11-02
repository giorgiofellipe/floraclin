import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { findMunicipalityCode } from '@bullcode/fiscal'
import { db } from '@/db/client'
import { getNfseSettings, listPaymentRecordsForEmission } from '@/db/queries/nfse'
import {
  appointments,
  financialEntries,
  installments,
  patients,
  paymentRecords,
  procedureRecords,
} from '@/db/schema'
import { handleApiError } from '@/lib/api-error'
import { createAuditLog } from '@/lib/audit'
import { isValidCep, isValidCpf, onlyDigits } from '@/lib/br-documents'
import { brToday } from '@/lib/dates'
import { BusinessError } from '@/lib/errors'
import { requireRole } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { competenceIsPastMonth, defaultCompetenceDate } from '@/lib/nfse/competence'
import { nfseEnvironment } from '@/lib/nfse/config'
import { createDocuments, processDocument, processDocuments } from '@/lib/nfse/emission'
import type { NfseProcessResult } from '@/lib/nfse/types'

export const maxDuration = 300

const MAX_IDS = 20
const EMIT_ROLES = ['owner', 'receptionist', 'financial'] as const
const TAKER_EDIT_ROLES = ['owner', 'receptionist']

type TakerField = 'cpf' | 'zip' | 'street' | 'number' | 'neighborhood' | 'city' | 'state'

const address = z.object({
  zip: z.string().refine(isValidCep, 'CEP inválido'),
  street: z.string().trim().min(1, 'Informe o logradouro').max(200),
  number: z.string().trim().min(1, 'Informe o número').max(20),
  complement: z.string().trim().max(100).nullable(),
  neighborhood: z.string().trim().min(1, 'Informe o bairro').max(100),
  city: z.string().trim().min(1, 'Informe a cidade').max(100),
  state: z.string().trim().length(2, 'UF inválida'),
})

const emitSchema = z.object({
  paymentRecordIds: z.array(z.guid()).min(1).max(MAX_IDS),
  competence: z.enum(['service', 'today']),
  sendEmail: z.boolean(),
  takers: z
    .array(
      z.object({
        patientId: z.guid(),
        cpf: z.string().refine(isValidCpf, 'CPF inválido'),
        address,
      }),
    )
    .optional(),
})

function businessResponse(error: BusinessError, status = 409) {
  return NextResponse.json({ error: error.message, code: error.code }, { status })
}

function formatCpf(value: string) {
  const d = onlyDigits(value)
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function formatCep(value: string) {
  const d = onlyDigits(value)
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

function missingFields(patient: { cpf: string | null; address: unknown }): TakerField[] {
  const a = (patient.address ?? {}) as Record<string, string | undefined>
  const missing: TakerField[] = []
  if (!isValidCpf(patient.cpf ?? '')) missing.push('cpf')
  if (!isValidCep(a.zip ?? '')) missing.push('zip')
  if (!a.street?.trim()) missing.push('street')
  if (!a.number?.trim()) missing.push('number')
  if (!a.neighborhood?.trim()) missing.push('neighborhood')
  if (!a.city?.trim() || (a.state && !findMunicipalityCode(a.city, a.state))) missing.push('city')
  if (!a.state?.trim()) missing.push('state')
  return missing
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole(...EMIT_ROLES)

    const raw = new URL(request.url).searchParams.get('paymentRecordIds') ?? ''
    const parsed = z.array(z.guid()).min(1).max(MAX_IDS).safeParse([...new Set(raw.split(',').filter(Boolean))])
    if (!parsed.success) {
      return NextResponse.json({ error: 'Pagamentos inválidos' }, { status: 400 })
    }
    const ids = parsed.data

    const records = await listPaymentRecordsForEmission(ctx.tenantId, ids)
    if (records.length !== ids.length) {
      return NextResponse.json({ error: 'Pagamento não encontrado.' }, { status: 404 })
    }

    const patientIds = [...new Set(records.map((r) => r.patientId))]
    const [patientRows, serviceRows, settings] = await Promise.all([
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
      getNfseSettings(ctx.tenantId),
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
      return {
        patientId: patient.id,
        patientName: patient.fullName,
        paymentRecordIds: own.map((r) => r.id),
        total: own.reduce((sum, r) => sum + Number(r.amount), 0),
        missing: missingFields(patient),
        email: patient.email,
        canEditTaker,
      }
    })

    return NextResponse.json({
      data: {
        patients: grouped,
        defaultCompetence,
        competenceIsPastMonth: competenceIsPastMonth(defaultCompetence, today),
        settings: { emailPatient: settings?.emailPatient ?? false },
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

    const parsed = emitSchema.safeParse(await request.json())
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
    if (!(await getNfseSettings(ctx.tenantId))) {
      return NextResponse.json(
        { error: 'Configure a NFS-e nas configurações.', code: 'NFSE_NOT_CONFIGURED' },
        { status: 409 },
      )
    }

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
      for (const taker of takers) {
        const next = { cpf: formatCpf(taker.cpf), address: { ...taker.address, zip: formatCep(taker.address.zip) } }
        const [previous] = await db
          .select({ cpf: patients.cpf, address: patients.address })
          .from(patients)
          .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, taker.patientId)))
        await db
          .update(patients)
          .set({ ...next, updatedAt: new Date() })
          .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, taker.patientId)))
        await createAuditLog({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action: 'update',
          entityType: 'patient',
          entityId: taker.patientId,
          changes: { patient: { old: previous, new: next } },
        })
      }
    }

    const retryIds = records.flatMap((r) => (r.failedDocumentId ? [r.failedDocumentId] : []))
    const freshIds = records.filter((r) => !r.failedDocumentId).map((r) => r.id)

    let createdIds: string[] = []
    if (freshIds.length > 0) {
      try {
        createdIds = await db.transaction(async (tx) => {
          const created = await createDocuments(tx as unknown as typeof db, {
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
    }

    const results: NfseProcessResult[] = []
    for (const id of retryIds) results.push(await processDocument(id, 'manual'))
    results.push(...(await processDocuments(createdIds, 'manual')))

    return NextResponse.json({ data: results })
  } catch (error) {
    return handleApiError(error, request)
  }
}
