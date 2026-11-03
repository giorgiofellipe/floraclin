'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FaceDiagramEditor } from '@/components/face-diagram/face-diagram-editor'
import { diagramsToPoints } from '@/components/face-diagram/points'
import { ReadOnlyGuard } from '@/components/layout/subscription-access'
import { useProcedures } from '@/hooks/queries/use-procedures'
import { usePatientPackages } from '@/hooks/queries/use-packages'
import { usePatientDiagramGroups } from '@/hooks/queries/use-face-diagram-groups'
import {
  usePatientAppointments,
  usePatientFinancialSummary,
} from '@/hooks/queries/use-patient-overview'
import { DIAGRAM_STATUS_LABELS } from '@/lib/face-diagram-status'
import { PROCEDURE_STATUS_COLORS, PROCEDURE_STATUS_LABELS, canWriteClinical } from '@/lib/constants'
import { formatBrDate } from '@/lib/dates'
import { cn, formatCurrency } from '@/lib/utils'
import type { Role } from '@/types'
import type { PatientSectionKey } from './patient-sections'
import {
  AppointmentStatusChip,
  formatAppointmentDate,
  isUpcomingAppointment,
} from './patient-agenda-section'

interface PatientSummaryProps {
  patientId: string
  role: Role
  onNavigate: (key: PatientSectionKey) => void
}

interface ProcedureRow {
  id: string
  procedureTypeName: string
  status: string
  performedAt: string | null
  approvedAt: string | null
}

const CARD = 'rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]'

function SummaryCard({
  title,
  linkLabel,
  onLink,
  children,
}: {
  title: string
  linkLabel: string
  onLink: () => void
  children: ReactNode
}) {
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
        <Button type="button" variant="link" className="h-auto p-0 text-xs text-sage" onClick={onLink}>
          {linkLabel}
        </Button>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-mid">{children}</p>
}

function DiagramsCard({ patientId, role, onNavigate }: PatientSummaryProps) {
  const { data: groups, isLoading } = usePatientDiagramGroups(patientId)
  const latest = groups?.find((g) => !g.procedureSessionId)
  const canCreate = canWriteClinical(role)

  function body() {
    if (isLoading) return <Skeleton className="h-32 w-full" />
    if (!latest) {
      return (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm text-mid">Nenhum diagrama facial</p>
          {canCreate && (
            <ReadOnlyGuard label="Novo diagrama">
              <Link
                href={`/pacientes/${patientId}/diagramas/novo`}
                className={cn(buttonVariants({ variant: 'outline' }), 'text-[13px]')}
              >
                Novo diagrama
              </Link>
            </ReadOnlyGuard>
          )}
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-mid">
          <span>{formatBrDate(latest.createdAt)}</span>
          <Badge variant="secondary">{DIAGRAM_STATUS_LABELS[latest.status]}</Badge>
          {latest.quotationTotal != null && (
            <span className="font-medium text-charcoal">{formatCurrency(latest.quotationTotal)}</span>
          )}
        </div>
        <div className="max-h-64 overflow-hidden">
          <FaceDiagramEditor points={diagramsToPoints(latest.views)} onChange={() => {}} readOnly />
        </div>
      </div>
    )
  }

  return (
    <SummaryCard title="Diagramas faciais" linkLabel="Ver todos" onLink={() => onNavigate('diagramas')}>
      {body()}
    </SummaryCard>
  )
}

function AppointmentsCard({ patientId, onNavigate }: PatientSummaryProps) {
  const { data, isLoading } = usePatientAppointments(patientId)
  const now = new Date()
  const next = (data ?? [])
    .filter((a) => a.status !== 'cancelled' && isUpcomingAppointment(a, now))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
    .slice(0, 3)

  function body() {
    if (isLoading) return <Skeleton className="h-20 w-full" />
    if (next.length === 0) return <Empty>Nenhum agendamento futuro</Empty>
    return (
      <ul className="space-y-2">
        {next.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-charcoal">
                {formatAppointmentDate(a.date)} às {a.startTime.slice(0, 5)}
              </p>
              <p className="truncate text-xs text-mid">{a.procedureTypeName ?? 'Sem procedimento'}</p>
            </div>
            <AppointmentStatusChip status={a.status} />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <SummaryCard title="Próximos agendamentos" linkLabel="Agenda" onLink={() => onNavigate('agenda')}>
      {body()}
    </SummaryCard>
  )
}

function ProceduresCard({ patientId, onNavigate }: PatientSummaryProps) {
  const { data, isLoading } = useProcedures(patientId)
  const recent = ((data ?? []) as unknown as ProcedureRow[])
    .filter((p) => p.status !== 'draft')
    .map((p) => ({ ...p, at: p.performedAt ?? p.approvedAt }))
    .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
    .slice(0, 3)

  function body() {
    if (isLoading) return <Skeleton className="h-20 w-full" />
    if (recent.length === 0) return <Empty>Nenhum atendimento</Empty>
    return (
      <ul className="space-y-2">
        {recent.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-charcoal">{p.procedureTypeName}</p>
              {p.at && <p className="text-xs text-mid">{formatBrDate(p.at)}</p>}
            </div>
            <Badge variant="secondary" className={PROCEDURE_STATUS_COLORS[p.status]}>
              {PROCEDURE_STATUS_LABELS[p.status] ?? p.status}
            </Badge>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <SummaryCard title="Últimos atendimentos" linkLabel="Ver todos" onLink={() => onNavigate('atendimentos')}>
      {body()}
    </SummaryCard>
  )
}

function FinancialCard({ patientId, onNavigate }: PatientSummaryProps) {
  const { data: summary, isLoading, isError } = usePatientFinancialSummary(patientId)
  const { data: packages } = usePatientPackages(patientId)
  const activePackage = (packages ?? []).find((p) => p.status === 'active')
  const total = activePackage?.records.reduce((sum, r) => sum + r.sessionsTotal, 0) ?? 0
  const done = activePackage?.records.reduce((sum, r) => sum + r.sessionsExecuted, 0) ?? 0

  function body() {
    if (isError) return <Empty>Não foi possível carregar o financeiro.</Empty>
    if (isLoading || !summary) return <Skeleton className="h-20 w-full" />
    return (
      <div className="space-y-1.5 text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-mid">Em aberto</dt>
            <dd className="font-medium text-charcoal">{formatCurrency(summary.openAmount)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-mid">Em atraso</dt>
            <dd className={cn('font-medium', summary.overdueAmount > 0 ? 'text-amber-700' : 'text-charcoal')}>
              {formatCurrency(summary.overdueAmount)}
            </dd>
          </div>
          {summary.nextDueDate && (
            <div className="flex justify-between gap-2">
              <dt className="text-mid">Próximo vencimento</dt>
              <dd className="font-medium text-charcoal">{formatAppointmentDate(summary.nextDueDate)}</dd>
            </div>
          )}
        </dl>
        {activePackage && (
          <p className="pt-1 text-xs text-mid">
            Pacote: {done} de {total} sessões
          </p>
        )}
      </div>
    )
  }

  return (
    <SummaryCard title="Financeiro" linkLabel="Ver tudo" onLink={() => onNavigate('financeiro')}>
      {body()}
    </SummaryCard>
  )
}

export function PatientSummary(props: PatientSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <DiagramsCard {...props} />
      <AppointmentsCard {...props} />
      <ProceduresCard {...props} />
      <FinancialCard {...props} />
    </div>
  )
}
