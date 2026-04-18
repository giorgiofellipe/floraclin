import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import {
  procedureRecords,
  procedureTypes,
  users,
  photoAssets,
  consentAcceptances,
  consentTemplates,
  appointments,
  installments,
  financialEntries,
  patients,
  anamneses,
} from '@/db/schema'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import type { TimelineEntry, TimelineGroup, PatientTimeline } from '@/types/timeline'

// ─── Label maps ─────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  pre: 'Pre-procedimento',
  immediate_post: 'Pos imediato',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  other: 'Outro',
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluido',
  cancelled: 'Cancelado',
  no_show: 'Nao compareceu',
}

const PAYMENT_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartao credito',
  debit_card: 'Cartao debito',
  cash: 'Dinheiro',
  transfer: 'Transferencia',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext()

    // Only owner, practitioner, and receptionist can view timeline
    if (!['owner', 'practitioner', 'receptionist'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: patientId } = await params
    const tenantId = ctx.tenantId

    const data = await buildPatientTimeline(tenantId, patientId)
    return NextResponse.json(data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function buildPatientTimeline(tenantId: string, patientId: string): Promise<PatientTimeline> {
  try {
    // 1. Fetch all base data in parallel
    const [
      patientData,
      anamnesisData,
      proceduresData,
      photosData,
      consentsData,
      appointmentsData,
      financialData,
      paymentsData,
    ] = await Promise.all([
      // Patient record
      db
        .select({
          id: patients.id,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .where(
          and(
            eq(patients.tenantId, tenantId),
            eq(patients.id, patientId),
            isNull(patients.deletedAt)
          )
        )
        .limit(1),

      // Anamnesis
      db
        .select({
          id: anamneses.id,
          updatedAt: anamneses.updatedAt,
          updatedByName: users.fullName,
        })
        .from(anamneses)
        .leftJoin(users, eq(users.id, anamneses.updatedBy))
        .where(
          and(
            eq(anamneses.tenantId, tenantId),
            eq(anamneses.patientId, patientId)
          )
        )
        .limit(1),

      // Procedure records with type names and practitioner
      db
        .select({
          id: procedureRecords.id,
          procedureTypeId: procedureRecords.procedureTypeId,
          additionalTypeIds: procedureRecords.additionalTypeIds,
          status: procedureRecords.status,
          createdAt: procedureRecords.createdAt,
          performedAt: procedureRecords.performedAt,
          approvedAt: procedureRecords.approvedAt,
          cancelledAt: procedureRecords.cancelledAt,
          cancellationReason: procedureRecords.cancellationReason,
          appointmentId: procedureRecords.appointmentId,
          typeName: procedureTypes.name,
          practitionerName: users.fullName,
        })
        .from(procedureRecords)
        .innerJoin(procedureTypes, eq(procedureTypes.id, procedureRecords.procedureTypeId))
        .innerJoin(users, eq(users.id, procedureRecords.practitionerId))
        .where(
          and(
            eq(procedureRecords.tenantId, tenantId),
            eq(procedureRecords.patientId, patientId),
            isNull(procedureRecords.deletedAt)
          )
        ),

      // Photos
      db
        .select({
          id: photoAssets.id,
          createdAt: photoAssets.createdAt,
          timelineStage: photoAssets.timelineStage,
          procedureRecordId: photoAssets.procedureRecordId,
        })
        .from(photoAssets)
        .where(
          and(
            eq(photoAssets.tenantId, tenantId),
            eq(photoAssets.patientId, patientId),
            isNull(photoAssets.deletedAt)
          )
        ),

      // Consent acceptances
      db
        .select({
          id: consentAcceptances.id,
          acceptedAt: consentAcceptances.acceptedAt,
          templateTitle: consentTemplates.title,
          templateType: consentTemplates.type,
          procedureRecordId: consentAcceptances.procedureRecordId,
        })
        .from(consentAcceptances)
        .innerJoin(
          consentTemplates,
          eq(consentTemplates.id, consentAcceptances.consentTemplateId)
        )
        .where(
          and(
            eq(consentAcceptances.tenantId, tenantId),
            eq(consentAcceptances.patientId, patientId)
          )
        ),

      // Appointments
      db
        .select({
          id: appointments.id,
          date: appointments.date,
          startTime: appointments.startTime,
          status: appointments.status,
          procedureTypeId: appointments.procedureTypeId,
          practitionerName: users.fullName,
          notes: appointments.notes,
        })
        .from(appointments)
        .innerJoin(users, eq(users.id, appointments.practitionerId))
        .where(
          and(
            eq(appointments.tenantId, tenantId),
            eq(appointments.patientId, patientId),
            isNull(appointments.deletedAt)
          )
        ),

      // Financial entries with their installments
      db
        .select({
          id: financialEntries.id,
          procedureRecordId: financialEntries.procedureRecordId,
          description: financialEntries.description,
          totalAmount: financialEntries.totalAmount,
          installmentCount: financialEntries.installmentCount,
          createdAt: financialEntries.createdAt,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.tenantId, tenantId),
            eq(financialEntries.patientId, patientId),
            isNull(financialEntries.deletedAt)
          )
        ),

      // Paid installments
      db
        .select({
          id: installments.id,
          paidAt: installments.paidAt,
          amount: installments.amount,
          paymentMethod: installments.paymentMethod,
          financialEntryId: installments.financialEntryId,
          description: financialEntries.description,
          procedureRecordId: financialEntries.procedureRecordId,
        })
        .from(installments)
        .innerJoin(
          financialEntries,
          eq(financialEntries.id, installments.financialEntryId)
        )
        .where(
          and(
            eq(installments.tenantId, tenantId),
            eq(financialEntries.patientId, patientId),
            eq(installments.status, 'paid')
          )
        ),
    ])

    // 2. Resolve additional type names for procedures with multiple types
    const allAdditionalTypeIds = proceduresData.flatMap((p) => {
      const ids = p.additionalTypeIds as string[] | null
      return ids ?? []
    })

    let additionalTypeMap: Record<string, string> = {}
    if (allAdditionalTypeIds.length > 0) {
      const additionalTypes = await db
        .select({ id: procedureTypes.id, name: procedureTypes.name })
        .from(procedureTypes)
        .where(inArray(procedureTypes.id, allAdditionalTypeIds))
      additionalTypeMap = Object.fromEntries(additionalTypes.map((t) => [t.id, t.name]))
    }

    // 3. Build a set of appointmentIds linked to procedures
    const linkedAppointmentIds = new Set(
      proceduresData
        .filter((p) => p.appointmentId)
        .map((p) => p.appointmentId!)
    )

    const typeIdToProcMap = new Map<string, string>()
    for (const p of proceduresData) {
      typeIdToProcMap.set(p.procedureTypeId, p.id)
    }

    // 4. Build groups from procedures
    const groups: TimelineGroup[] = proceduresData.map((proc) => {
      const additionalIds = (proc.additionalTypeIds as string[] | null) ?? []
      const allTypeNames = [
        proc.typeName,
        ...additionalIds.map((id) => additionalTypeMap[id]).filter(Boolean),
      ]
      const title = allTypeNames.join(' + ')

      const entries: TimelineEntry[] = []

      // plan_created
      entries.push({
        id: `plan-created-${proc.id}`,
        type: 'plan_created',
        date: new Date(proc.createdAt).toISOString(),
        title: 'Planejamento criado',
        procedureId: proc.id,
      })

      // consent_signed & contract_signed for this procedure
      for (const c of consentsData) {
        if (c.procedureRecordId !== proc.id) continue
        const isContract = c.templateType === 'service_contract'
        entries.push({
          id: `consent-${c.id}`,
          type: isContract ? 'contract_signed' : 'consent_signed',
          date: new Date(c.acceptedAt).toISOString(),
          title: isContract
            ? 'Contrato de servico assinado'
            : `Termo assinado: ${c.templateTitle}`,
          procedureId: proc.id,
        })
      }

      // plan_approved
      if (proc.approvedAt) {
        entries.push({
          id: `plan-approved-${proc.id}`,
          type: 'plan_approved',
          date: new Date(proc.approvedAt).toISOString(),
          title: 'Procedimento aprovado',
          procedureId: proc.id,
        })
      }

      // financial_created
      for (const fe of financialData) {
        if (fe.procedureRecordId !== proc.id) continue
        const installmentLabel = fe.installmentCount > 1 ? ` (${fe.installmentCount}x)` : ''
        entries.push({
          id: `fin-${fe.id}`,
          type: 'financial_created',
          date: new Date(fe.createdAt).toISOString(),
          title: `Cobranca criada: R$ ${Number(fe.totalAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${installmentLabel}`,
          procedureId: proc.id,
        })
      }

      // photo_uploaded
      for (const ph of photosData) {
        if (ph.procedureRecordId !== proc.id) continue
        const stageLabel = ph.timelineStage
          ? STAGE_LABELS[ph.timelineStage] ?? ph.timelineStage
          : 'Foto'
        entries.push({
          id: `photo-${ph.id}`,
          type: 'photo_uploaded',
          date: new Date(ph.createdAt).toISOString(),
          title: `Foto ${stageLabel.toLowerCase()}`,
          procedureId: proc.id,
        })
      }

      // plan_executed
      if (proc.status === 'executed' && proc.performedAt) {
        entries.push({
          id: `plan-exec-${proc.id}`,
          type: 'plan_executed',
          date: new Date(proc.performedAt).toISOString(),
          title: 'Procedimento executado',
          meta: `por ${proc.practitionerName}`,
          procedureId: proc.id,
        })
      }

      // plan_cancelled
      if (proc.status === 'cancelled' && proc.cancelledAt) {
        entries.push({
          id: `plan-cancel-${proc.id}`,
          type: 'plan_cancelled',
          date: new Date(proc.cancelledAt).toISOString(),
          title: 'Procedimento cancelado',
          description: proc.cancellationReason ?? undefined,
          procedureId: proc.id,
        })
      }

      // payment_received
      for (const pay of paymentsData) {
        if (pay.procedureRecordId !== proc.id || !pay.paidAt) continue
        const methodLabel = pay.paymentMethod
          ? ` via ${PAYMENT_LABELS[pay.paymentMethod] ?? pay.paymentMethod}`
          : ''
        entries.push({
          id: `pay-${pay.id}`,
          type: 'payment_received',
          date: new Date(pay.paidAt).toISOString(),
          title: `Pagamento: R$ ${Number(pay.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${methodLabel}`,
          procedureId: proc.id,
        })
      }

      // Appointments linked to this procedure
      for (const appt of appointmentsData) {
        const isDirectLink = proc.appointmentId === appt.id
        const isTypeLink = appt.procedureTypeId === proc.procedureTypeId
        if (!isDirectLink && !isTypeLink) continue
        linkedAppointmentIds.add(appt.id)
        entries.push({
          id: `appt-${appt.id}-${proc.id}`,
          type: 'appointment',
          date: `${appt.date}T${appt.startTime}`,
          title: `Consulta agendada as ${appt.startTime.slice(0, 5)}`,
          meta: `${STATUS_LABELS[appt.status] ?? appt.status} - ${appt.practitionerName}`,
          procedureId: proc.id,
        })
      }

      // Sort entries within group chronologically (oldest first)
      entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      return {
        id: `group-${proc.id}`,
        type: 'service' as const,
        procedureId: proc.id,
        title,
        status: proc.status,
        entries,
      }
    })

    // 5. Build ungrouped entries
    const ungrouped: TimelineEntry[] = []

    // patient_created
    if (patientData.length > 0) {
      ungrouped.push({
        id: `patient-created-${patientData[0].id}`,
        type: 'patient_created',
        date: new Date(patientData[0].createdAt).toISOString(),
        title: 'Cadastro do paciente',
      })
    }

    // anamnesis_updated
    if (anamnesisData.length > 0) {
      const anamnesis = anamnesisData[0]
      const byLabel = anamnesis.updatedByName ? ` (por ${anamnesis.updatedByName})` : ''
      ungrouped.push({
        id: `anamnesis-${anamnesis.id}`,
        type: 'anamnesis_updated',
        date: new Date(anamnesis.updatedAt).toISOString(),
        title: `Anamnese atualizada${byLabel}`,
      })
    }

    // Orphan photos (not linked to any procedure)
    for (const ph of photosData) {
      if (ph.procedureRecordId) continue
      const stageLabel = ph.timelineStage
        ? STAGE_LABELS[ph.timelineStage] ?? ph.timelineStage
        : 'Foto'
      ungrouped.push({
        id: `photo-${ph.id}`,
        type: 'photo_uploaded',
        date: new Date(ph.createdAt).toISOString(),
        title: `Foto avulsa — ${stageLabel.toLowerCase()}`,
      })
    }

    // Unlinked appointments
    for (const appt of appointmentsData) {
      if (linkedAppointmentIds.has(appt.id)) continue
      ungrouped.push({
        id: `appt-${appt.id}`,
        type: 'appointment',
        date: `${appt.date}T${appt.startTime}`,
        title: `Consulta agendada as ${appt.startTime.slice(0, 5)}`,
        meta: `${STATUS_LABELS[appt.status] ?? appt.status} - ${appt.practitionerName}`,
      })
    }

    // Sort ungrouped by date desc
    ungrouped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // 6. Sort groups by most recent event date (desc)
    groups.sort((a, b) => {
      const aMax = a.entries.length > 0
        ? Math.max(...a.entries.map((e) => new Date(e.date).getTime()))
        : 0
      const bMax = b.entries.length > 0
        ? Math.max(...b.entries.map((e) => new Date(e.date).getTime()))
        : 0
      return bMax - aMax
    })

    return { groups, ungrouped }
  } catch {
    return { groups: [], ungrouped: [] }
  }
}
