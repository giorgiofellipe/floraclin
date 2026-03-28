'use server'

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
} from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

export interface TimelineEntry {
  id: string
  type: 'procedure' | 'photo' | 'consent' | 'appointment' | 'payment'
  date: string
  title: string
  description?: string
  meta?: string
}

const STAGE_LABELS: Record<string, string> = {
  pre: 'Pré',
  immediate_post: 'Pós imediato',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  other: 'Outro',
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
}

const PAYMENT_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão crédito',
  debit_card: 'Cartão débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
}

export async function getPatientTimelineAction(patientId: string): Promise<TimelineEntry[]> {
  const ctx = await getAuthContext()
  const tenantId = ctx.tenantId

  try {
    const [
      proceduresData,
      photosData,
      consentsData,
      appointmentsData,
      paymentsData,
    ] = await Promise.all([
      db
        .select({
          id: procedureRecords.id,
          performedAt: procedureRecords.performedAt,
          typeName: procedureTypes.name,
          practitionerName: users.fullName,
          technique: procedureRecords.technique,
          status: procedureRecords.status,
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

      db
        .select({
          id: photoAssets.id,
          createdAt: photoAssets.createdAt,
          originalFilename: photoAssets.originalFilename,
          timelineStage: photoAssets.timelineStage,
          notes: photoAssets.notes,
        })
        .from(photoAssets)
        .where(
          and(
            eq(photoAssets.tenantId, tenantId),
            eq(photoAssets.patientId, patientId),
            isNull(photoAssets.deletedAt)
          )
        ),

      db
        .select({
          id: consentAcceptances.id,
          acceptedAt: consentAcceptances.acceptedAt,
          templateTitle: consentTemplates.title,
          templateType: consentTemplates.type,
          acceptanceMethod: consentAcceptances.acceptanceMethod,
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

      db
        .select({
          id: appointments.id,
          date: appointments.date,
          startTime: appointments.startTime,
          status: appointments.status,
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

      db
        .select({
          id: installments.id,
          paidAt: installments.paidAt,
          amount: installments.amount,
          paymentMethod: installments.paymentMethod,
          description: financialEntries.description,
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

    const timeline: TimelineEntry[] = [
      ...proceduresData.map((p) => ({
        id: `proc-${p.id}`,
        type: 'procedure' as const,
        date: new Date(p.performedAt).toISOString(),
        title: p.typeName,
        description: p.technique ?? undefined,
        meta: `por ${p.practitionerName}`,
      })),

      ...photosData.map((p) => ({
        id: `photo-${p.id}`,
        type: 'photo' as const,
        date: new Date(p.createdAt).toISOString(),
        title: p.originalFilename ?? 'Foto',
        description: p.notes ?? undefined,
        meta: p.timelineStage
          ? STAGE_LABELS[p.timelineStage] ?? p.timelineStage
          : undefined,
      })),

      ...consentsData.map((c) => ({
        id: `consent-${c.id}`,
        type: 'consent' as const,
        date: new Date(c.acceptedAt).toISOString(),
        title: c.templateTitle,
        meta: c.acceptanceMethod === 'signature'
          ? 'Assinado'
          : c.acceptanceMethod === 'both'
            ? 'Checkbox + Assinatura'
            : 'Checkbox',
      })),

      ...appointmentsData.map((a) => ({
        id: `appt-${a.id}`,
        type: 'appointment' as const,
        date: `${a.date}T${a.startTime}`,
        title: `Consulta - ${a.startTime}`,
        description: a.notes ?? undefined,
        meta: `${STATUS_LABELS[a.status] ?? a.status} - ${a.practitionerName}`,
      })),

      ...paymentsData
        .filter((p) => p.paidAt)
        .map((p) => ({
          id: `pay-${p.id}`,
          type: 'payment' as const,
          date: new Date(p.paidAt!).toISOString(),
          title: p.description,
          meta: p.paymentMethod
            ? `R$ ${Number(p.amount).toFixed(2)} via ${PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod}`
            : `R$ ${Number(p.amount).toFixed(2)}`,
        })),
    ]

    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return timeline
  } catch {
    return []
  }
}
