'use client'

import { useEffect, useState } from 'react'
import {
  Loader2,
  Syringe,
  Camera,
  FileCheck,
  Calendar,
  CreditCard,
  Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────

type TimelineEntryType = 'procedure' | 'photo' | 'consent' | 'appointment' | 'payment'

interface TimelineEntry {
  id: string
  type: TimelineEntryType
  date: Date | string
  title: string
  description?: string
  meta?: string
}

const TYPE_CONFIG: Record<TimelineEntryType, {
  icon: typeof Syringe
  label: string
  color: string
}> = {
  procedure: { icon: Syringe, label: 'Procedimento', color: 'bg-sage/20 text-sage' },
  photo: { icon: Camera, label: 'Foto', color: 'bg-mint/20 text-forest' },
  consent: { icon: FileCheck, label: 'Termo', color: 'bg-blush text-charcoal' },
  appointment: { icon: Calendar, label: 'Agendamento', color: 'bg-sage/10 text-sage' },
  payment: { icon: CreditCard, label: 'Pagamento', color: 'bg-petal text-forest' },
}

interface PatientTimelineTabProps {
  patientId: string
}

export function PatientTimelineTab({ patientId }: PatientTimelineTabProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadTimeline() {
      try {
        const { db } = await import('@/db/client')
        const {
          procedureRecords,
          procedureTypes,
          users,
          photoAssets,
          consentAcceptances,
          consentTemplates,
          appointments,
          installments,
          financialEntries,
        } = await import('@/db/schema')
        const { eq, and, isNull, desc } = await import('drizzle-orm')
        const { getAuthContext } = await import('@/lib/auth')

        const ctx = await getAuthContext()
        const tenantId = ctx.tenantId

        // Fetch all data sources in parallel
        const [
          proceduresData,
          photosData,
          consentsData,
          appointmentsData,
          paymentsData,
        ] = await Promise.all([
          // Procedures
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

          // Photos
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

          // Consent acceptances
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

          // Appointments
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

          // Payments (paid installments)
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

        if (cancelled) return

        const STAGE_LABELS: Record<string, string> = {
          pre: 'Pre',
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

        const timeline: TimelineEntry[] = [
          ...proceduresData.map((p) => ({
            id: `proc-${p.id}`,
            type: 'procedure' as const,
            date: p.performedAt,
            title: p.typeName,
            description: p.technique ?? undefined,
            meta: `por ${p.practitionerName}`,
          })),

          ...photosData.map((p) => ({
            id: `photo-${p.id}`,
            type: 'photo' as const,
            date: p.createdAt,
            title: p.originalFilename ?? 'Foto',
            description: p.notes ?? undefined,
            meta: p.timelineStage
              ? STAGE_LABELS[p.timelineStage] ?? p.timelineStage
              : undefined,
          })),

          ...consentsData.map((c) => ({
            id: `consent-${c.id}`,
            type: 'consent' as const,
            date: c.acceptedAt,
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
              date: p.paidAt!,
              title: p.description,
              meta: p.paymentMethod
                ? `R$ ${Number(p.amount).toFixed(2)} via ${PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod}`
                : `R$ ${Number(p.amount).toFixed(2)}`,
            })),
        ]

        // Sort by date descending
        timeline.sort((a, b) => {
          const dateA = new Date(a.date).getTime()
          const dateB = new Date(b.date).getTime()
          return dateB - dateA
        })

        setEntries(timeline)
      } catch {
        setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTimeline()
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando timeline...</span>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-mid">
        <Clock className="mb-2 size-8" />
        <p className="text-sm">Nenhuma atividade registrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry, index) => {
        const config = TYPE_CONFIG[entry.type]
        const Icon = config.icon

        return (
          <div key={entry.id} className="flex gap-3">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.color}`}>
                <Icon className="size-4" />
              </div>
              {index < entries.length - 1 && (
                <div className="w-px flex-1 bg-border" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-6">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {config.label}
                </Badge>
                <span className="text-xs text-mid">
                  {formatDateTime(entry.date)}
                </span>
              </div>
              <h4 className="mt-1 text-sm font-medium text-charcoal">
                {entry.title}
              </h4>
              {entry.description && (
                <p className="text-sm text-mid">{entry.description}</p>
              )}
              {entry.meta && (
                <p className="text-xs text-mid">{entry.meta}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
